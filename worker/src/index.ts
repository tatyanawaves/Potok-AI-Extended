/**
 * Potok ↔ Pipedream Connect bridge.
 *
 * Pipedream's MCP endpoint allows browser origins, but it authenticates with a
 * token minted from the project's client_secret — a workspace-wide credential
 * that can act for ANY end user. Handing that to the browser would let any
 * visitor set x-pd-external-user-id to someone else's id and reach their
 * connected accounts, so the token never leaves this worker: MCP traffic is
 * proxied and the user's identity is taken from a verified Firebase ID token
 * rather than from the request body.
 *
 * This is not the LLM worker that was removed earlier. That one held a shared
 * model key and so paid for everyone's usage; this holds no shared resource —
 * each user connects their own Slack, Notion and so on.
 *
 * Endpoints:
 *   POST /pd/connect-token  → short-lived token for the account-connect UI
 *   POST /pd/mcp            → MCP JSON-RPC, proxied with injected credentials
 *   GET  /health
 */

export interface Env {
    FIREBASE_PROJECT_ID: string;
    PIPEDREAM_PROJECT_ID: string;
    PIPEDREAM_CLIENT_ID: string;
    PIPEDREAM_ENVIRONMENT: string;
    ALLOWED_ORIGINS: string;
    PIPEDREAM_CLIENT_SECRET?: string;
}

// --- Firebase ID token verification ---------------------------------------

const JWKS_URL =
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Jwk {
    kid: string;
    n: string;
    e: string;
    kty: string;
    alg: string;
}

let cachedKeys: { keys: Jwk[]; expiresAt: number } | null = null;

const fetchSigningKeys = async (): Promise<Jwk[]> => {
    if (cachedKeys && cachedKeys.expiresAt > Date.now()) {
        return cachedKeys.keys;
    }

    const response = await fetch(JWKS_URL);
    if (!response.ok) {
        throw new Error(`Could not fetch Google signing keys: ${response.status}`);
    }

    const body = (await response.json()) as { keys: Jwk[] };

    // Respect the endpoint's cache lifetime; fall back to an hour.
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);

    cachedKeys = { keys: body.keys, expiresAt: Date.now() + maxAge * 1000 };
    return body.keys;
};

const base64UrlDecode = (input: string): Uint8Array => {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
};

/**
 * Verifies a Firebase ID token and returns its uid.
 * Throws when the token is malformed, expired, or not issued for this project.
 */
const verifyIdToken = async (token: string, projectId: string): Promise<string> => {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');

    const [rawHeader, rawPayload, rawSignature] = parts;

    let header: any;
    let payload: any;
    try {
        header = JSON.parse(new TextDecoder().decode(base64UrlDecode(rawHeader)));
        payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(rawPayload)));
    } catch {
        throw new Error('Malformed token');
    }

    if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

    const keys = await fetchSigningKeys();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('Unknown signing key');

    const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const isValid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        base64UrlDecode(rawSignature),
        new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    );

    if (!isValid) throw new Error('Invalid token signature');

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) throw new Error('Token expired');
    if (payload.iat > now + 300) throw new Error('Token issued in the future');
    if (payload.aud !== projectId) throw new Error('Token audience mismatch');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
        throw new Error('Token issuer mismatch');
    }
    if (!payload.sub) throw new Error('Token has no subject');

    return payload.sub as string;
};

// --- Prompting -------------------------------------------------------------
// --- Pipedream ------------------------------------------------------------

const PIPEDREAM_API = 'https://api.pipedream.com/v1';
const PIPEDREAM_MCP = 'https://remote.mcp.pipedream.net/v3';

/** Access tokens last an hour; re-minting on every call would be wasteful. */
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

const getAccessToken = async (env: Env): Promise<string> => {
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
        return cachedAccessToken.token;
    }

    if (!env.PIPEDREAM_CLIENT_SECRET) {
        throw new Error(
            'PIPEDREAM_CLIENT_SECRET is not set. Run: wrangler secret put PIPEDREAM_CLIENT_SECRET'
        );
    }

    const response = await fetch(`${PIPEDREAM_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: env.PIPEDREAM_CLIENT_ID,
            client_secret: env.PIPEDREAM_CLIENT_SECRET
        })
    });

    if (!response.ok) {
        // Pipedream's body says which half is wrong (unknown client vs bad
        // secret); without it a 401 here is undiagnosable.
        const detail = await response.text().catch(() => '');
        throw new Error(`Pipedream token exchange failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number };
    cachedAccessToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
    };

    return data.access_token;
};

// --- HTTP helpers ---------------------------------------------------------

const corsHeaders = (env: Env, origin: string | null): Record<string, string> => {
    const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
    const isAllowed = origin !== null && allowed.includes(origin);

    return {
        'Access-Control-Allow-Origin': isAllowed ? origin : allowed[0] || '',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
    };
};

const json = (body: unknown, status: number, headers: Record<string, string>) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
    });

const requireUid = async (request: Request, env: Env): Promise<string> => {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) throw new Error('Missing Firebase ID token');
    return verifyIdToken(token, env.FIREBASE_PROJECT_ID);
};

// --- Handlers -------------------------------------------------------------

/**
 * Mints a token for Pipedream's account-connect UI.
 * The external user id comes from the verified Firebase uid, never from the
 * request, so a caller cannot connect accounts on someone else's behalf.
 */
const handleConnectToken = async (
    request: Request, env: Env, uid: string, cors: Record<string, string>
): Promise<Response> => {
    let body: { appSlug?: string } = {};
    try {
        body = (await request.json()) as any;
    } catch {
        // Body is optional here.
    }

    const accessToken = await getAccessToken(env);

    const response = await fetch(
        `${PIPEDREAM_API}/connect/${env.PIPEDREAM_PROJECT_ID}/tokens`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-PD-Environment': env.PIPEDREAM_ENVIRONMENT
            },
            body: JSON.stringify({
                external_user_id: uid,
                ...(body.appSlug ? { allowed_origins: [], app: body.appSlug } : {})
            })
        }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        return json({ error: 'Pipedream rejected the token request', detail: data }, 502, cors);
    }

    return json(data, 200, cors);
};

/**
 * Lists the accounts this user has connected, so the app can offer them as
 * tool servers instead of asking people to type app slugs.
 */
const handleAccounts = async (
    _request: Request, env: Env, uid: string, cors: Record<string, string>
): Promise<Response> => {
    const accessToken = await getAccessToken(env);

    const url = new URL(`${PIPEDREAM_API}/connect/${env.PIPEDREAM_PROJECT_ID}/accounts`);
    url.searchParams.set('external_user_id', uid);

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-PD-Environment': env.PIPEDREAM_ENVIRONMENT
        }
    });

    const data = (await response.json().catch(() => ({}))) as any;

    if (!response.ok) {
        return json({ error: 'Pipedream rejected the account list', detail: data }, 502, cors);
    }

    // Trimmed to what the UI needs; the raw payload carries credential metadata.
    const accounts = (data.data || []).map((account: any) => ({
        id: account.id,
        name: account.name || account.external_id || account.app?.name,
        appSlug: account.app?.name_slug,
        appName: account.app?.name,
        healthy: account.healthy !== false
    }));

    return json({ accounts }, 200, cors);
};

/** Forwards one MCP JSON-RPC message, adding the credentials and identity. */
const handleMcp = async (
    request: Request, env: Env, uid: string, cors: Record<string, string>
): Promise<Response> => {
    const appSlug = new URL(request.url).searchParams.get('app');
    if (!appSlug) {
        return json({ error: 'Query parameter "app" is required, e.g. ?app=slack' }, 400, cors);
    }

    const accessToken = await getAccessToken(env);
    const rpcBody = await request.text();

    const response = await fetch(PIPEDREAM_MCP, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'x-pd-project-id': env.PIPEDREAM_PROJECT_ID,
            'x-pd-environment': env.PIPEDREAM_ENVIRONMENT,
            'x-pd-external-user-id': uid,
            'x-pd-app-slug': appSlug
        },
        body: rpcBody
    });

    // Passed through as-is: the MCP client understands both JSON and SSE.
    return new Response(response.body, {
        status: response.status,
        headers: {
            ...cors,
            'Content-Type': response.headers.get('content-type') || 'application/json'
        }
    });
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const origin = request.headers.get('Origin');
        const cors = corsHeaders(env, origin);
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (url.pathname === '/health') {
            return json({
                ok: true,
                project: env.PIPEDREAM_PROJECT_ID,
                environment: env.PIPEDREAM_ENVIRONMENT,
                secretConfigured: Boolean(env.PIPEDREAM_CLIENT_SECRET)
            }, 200, cors);
        }

        if (request.method !== 'POST') {
            return json({ error: 'Not found' }, 404, cors);
        }

        let uid: string;
        try {
            uid = await requireUid(request, env);
        } catch (error) {
            return json(
                { error: `Unauthorized: ${error instanceof Error ? error.message : String(error)}` },
                401, cors
            );
        }

        try {
            if (url.pathname === '/pd/connect-token') {
                return await handleConnectToken(request, env, uid, cors);
            }
            if (url.pathname === '/pd/accounts') {
                return await handleAccounts(request, env, uid, cors);
            }
            if (url.pathname === '/pd/mcp') {
                return await handleMcp(request, env, uid, cors);
            }
            return json({ error: 'Not found' }, 404, cors);
        } catch (error) {
            return json(
                { error: error instanceof Error ? error.message : String(error) },
                502, cors
            );
        }
    }
};
