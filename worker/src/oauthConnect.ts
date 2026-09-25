/**
 * Connecting MCP servers that sign in with OAuth — Higgsfield, and any other
 * server following the MCP authorization spec (protected-resource metadata,
 * dynamic client registration, PKCE).
 *
 * The browser cannot reach such servers directly: they refuse browser origins
 * (Higgsfield answers the CORS preflight with 403) and their tokens should not
 * sit in page storage. So the worker does both halves:
 *
 *   POST /oauth/start       { server }  → URL of the provider's sign-in page
 *   GET  /oauth/callback                → provider redirects here; tokens kept
 *   POST /oauth/status      { server }  → connected or not
 *   POST /oauth/disconnect  { server }
 *   POST /connect/mcp?server=<url>      → MCP proxied with the user's token
 *
 * Tokens are per Potok user and per server, sealed (./taskCrypto) in KV, and
 * refreshed here when they expire. A bot is given the /connect/mcp address
 * like any other tool server; whoever invokes it acts with their own account.
 */

import { seal, open } from './taskCrypto';

export interface KvLike {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
}

export interface OAuthEnv {
    CONNECTOR_TOKENS?: KvLike;
    TASK_SEALING_SECRET?: string;
    PIPEDREAM_CLIENT_SECRET?: string;
}

interface ServerAuth {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint?: string;
    scopes: string[];
}

interface Tokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
}

type Json = (body: unknown, status: number) => Response;

const secretOf = (env: OAuthEnv) => env.TASK_SEALING_SECRET || env.PIPEDREAM_CLIENT_SECRET || '';

const hash = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
};

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokenKey = async (uid: string, server: string) => `tok:${uid}:${await hash(server)}`;

export const checkServerUrl = (raw: unknown): string => {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:') throw new Error('Only https MCP servers can be connected');
    return url.toString();
};

/** Finds where to sign in, the way MCP clients are meant to: from the server's own metadata. */
const discover = async (server: string): Promise<ServerAuth> => {
    const url = new URL(server);
    let resourceMeta: any = null;
    for (const candidate of [
        `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`,
        `${url.origin}/.well-known/oauth-protected-resource`
    ]) {
        const r = await fetch(candidate);
        if (r.ok) { resourceMeta = await r.json(); break; }
    }
    const issuer: string = resourceMeta?.authorization_servers?.[0] || url.origin;

    let meta: any = null;
    for (const candidate of [`${issuer}/.well-known/oauth-authorization-server`, `${issuer}/.well-known/openid-configuration`]) {
        const r = await fetch(candidate);
        if (r.ok) { meta = await r.json(); break; }
    }
    if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
        throw new Error('This server does not publish OAuth metadata MCP clients can use');
    }
    return {
        authorizationEndpoint: meta.authorization_endpoint,
        tokenEndpoint: meta.token_endpoint,
        registrationEndpoint: meta.registration_endpoint,
        scopes: resourceMeta?.scopes_supported || ['openid', 'offline_access']
    };
};

/** One registered client per server and redirect address, reused by every user. */
const clientFor = async (env: OAuthEnv, server: string, auth: ServerAuth, redirectUri: string): Promise<string> => {
    const kv = env.CONNECTOR_TOKENS!;
    const key = `client:${await hash(server + redirectUri)}`;
    const cached = await kv.get(key);
    if (cached) return cached;

    if (!auth.registrationEndpoint) throw new Error('The server does not allow client registration');
    const r = await fetch(auth.registrationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Potok',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none'
        })
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.client_id) throw new Error(`Client registration failed: ${data.error_description || data.error || r.status}`);
    await kv.put(key, data.client_id);
    return data.client_id;
};

export const handleOAuthStart = async (
    request: Request, env: OAuthEnv, uid: string, json: Json
): Promise<Response> => {
    if (!env.CONNECTOR_TOKENS || !secretOf(env)) return json({ error: 'OAuth connectors are not enabled on this worker' }, 501);
    const body: any = await request.json().catch(() => ({}));
    const server = checkServerUrl(body.server);

    const auth = await discover(server);
    const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
    const clientId = await clientFor(env, server, auth, redirectUri);

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));

    // Ten minutes to finish signing in; the state is what ties the callback to this user.
    await env.CONNECTOR_TOKENS.put(`state:${state}`, await seal({
        uid, server, verifier, clientId, redirectUri, tokenEndpoint: auth.tokenEndpoint
    }, secretOf(env)), { expirationTtl: 600 });

    const url = new URL(auth.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', auth.scopes.join(' '));
    url.searchParams.set('resource', server);
    return json({ authorizeUrl: url.toString() }, 200);
};

const page = (title: string, text: string, status = 200) => new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#020617;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:26rem"><h2>${title}</h2><p style="color:#94a3b8">${text}</p></div>
<script>setTimeout(() => window.close(), 2500)</script></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

const exchange = async (tokenEndpoint: string, params: Record<string, string>): Promise<Tokens> => {
    const r = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams(params).toString()
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || `token endpoint ${r.status}`);
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || params.refresh_token,
        expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined
    };
};

export const handleOAuthCallback = async (request: Request, env: OAuthEnv): Promise<Response> => {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!env.CONNECTOR_TOKENS) return page('Не настроено', 'OAuth-коннекторы не включены.', 501);
    if (url.searchParams.get('error')) return page('Вход отменён', url.searchParams.get('error_description') || url.searchParams.get('error')!, 400);

    const sealed = await env.CONNECTOR_TOKENS.get(`state:${state}`);
    if (!sealed || !code) return page('Ссылка устарела', 'Начните подключение заново из Potok.', 400);
    await env.CONNECTOR_TOKENS.delete(`state:${state}`);

    const pending = await open<any>(sealed, secretOf(env));
    try {
        const tokens = await exchange(pending.tokenEndpoint, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: pending.redirectUri,
            client_id: pending.clientId,
            code_verifier: pending.verifier,
            resource: pending.server
        });
        await env.CONNECTOR_TOKENS.put(await tokenKey(pending.uid, pending.server), await seal({
            ...tokens, clientId: pending.clientId, tokenEndpoint: pending.tokenEndpoint
        }, secretOf(env)));
        return page('Подключено', `${new URL(pending.server).host} подключён к Potok. Окно можно закрыть.`);
    } catch (error) {
        return page('Не удалось подключить', error instanceof Error ? error.message : String(error), 502);
    }
};

/** The user's token for a server, refreshed when it is about to expire. */
const accessToken = async (env: OAuthEnv, uid: string, server: string): Promise<string | null> => {
    const kv = env.CONNECTOR_TOKENS!;
    const key = await tokenKey(uid, server);
    const sealed = await kv.get(key);
    if (!sealed) return null;

    const stored = await open<Tokens & { clientId: string, tokenEndpoint: string }>(sealed, secretOf(env));
    if (!stored.expires_at || stored.expires_at > Date.now() + 60_000 || !stored.refresh_token) return stored.access_token;

    const fresh = await exchange(stored.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: stored.refresh_token,
        client_id: stored.clientId,
        resource: server
    });
    await kv.put(key, await seal({ ...stored, ...fresh }, secretOf(env)));
    return fresh.access_token;
};

export const handleOAuthStatus = async (request: Request, env: OAuthEnv, uid: string, json: Json): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    const server = checkServerUrl(body.server);
    if (!env.CONNECTOR_TOKENS) return json({ connected: false, enabled: false }, 200);
    return json({ connected: Boolean(await env.CONNECTOR_TOKENS.get(await tokenKey(uid, server))), enabled: true }, 200);
};

export const handleOAuthDisconnect = async (request: Request, env: OAuthEnv, uid: string, json: Json): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    const server = checkServerUrl(body.server);
    await env.CONNECTOR_TOKENS?.delete(await tokenKey(uid, server));
    return json({ ok: true }, 200);
};

/** MCP traffic to a connected server, carried with the caller's own token. */
export const handleConnectedMcp = async (
    request: Request, env: OAuthEnv, uid: string, cors: Record<string, string>
): Promise<Response> => {
    const server = checkServerUrl(new URL(request.url).searchParams.get('server'));
    const token = env.CONNECTOR_TOKENS ? await accessToken(env, uid, server) : null;
    if (!token) {
        return new Response(JSON.stringify({ error: `${new URL(server).host} не подключён: подключите его в настройках Potok` }), {
            status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': request.headers.get('Accept') || 'application/json, text/event-stream'
    };
    for (const name of ['Mcp-Session-Id', 'MCP-Protocol-Version']) {
        const value = request.headers.get(name);
        if (value) headers[name] = value;
    }

    const upstream = await fetch(server, { method: 'POST', headers, body: await request.text() });
    const out = new Headers(cors);
    for (const name of ['Content-Type', 'Mcp-Session-Id']) {
        const value = upstream.headers.get(name);
        if (value) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
};
