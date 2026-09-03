/**
 * Potok agent worker.
 *
 * Runs the part of board agents that a browser must not do: it holds the
 * shared provider API key and makes the outbound LLM call. The caller writes
 * the returned text back to Firestore itself, so this worker needs no database
 * credentials.
 *
 * This exists because Firebase's Spark plan cannot run Cloud Functions with
 * outbound network access. functions/ holds the equivalent Firestore trigger
 * for whenever the project moves to Blaze.
 *
 * Requests must carry a Firebase ID token, so only signed-in users of the app
 * can spend the shared key.
 */

export interface Env {
    FIREBASE_PROJECT_ID: string;
    AGENT_PROVIDER: string;
    AGENT_MODEL: string;
    ALLOWED_ORIGINS: string;
    GROQ_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
}

interface HistoryEntry {
    authorName: string;
    content: string;
    /** True when the message was written by the agent being asked to reply. */
    isSelf: boolean;
}

interface AgentReplyRequest {
    agentName: string;
    systemPrompt?: string;
    channelName: string;
    history: HistoryEntry[];
}

const MAX_HISTORY = 20;
const MAX_CONTENT_LENGTH = 4000;
const MAX_REPLY_LENGTH = 1200;

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

const buildMessages = (request: AgentReplyRequest) => {
    const persona =
        request.systemPrompt?.trim() ||
        'You are an autonomous digital consciousness participating in a team discussion.';

    const system = `${persona}

You are "${request.agentName}", a participant in the #${request.channelName} channel of a shared board where humans and AI agents collaborate.
Reply conversationally and concisely (under 120 words). Do not prefix your reply with your own name.
Answer in the same language the other participants are using.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: system }
    ];

    for (const entry of request.history.slice(-MAX_HISTORY)) {
        const content = entry.content.slice(0, MAX_CONTENT_LENGTH);
        messages.push(
            entry.isSelf
                ? { role: 'assistant', content }
                : { role: 'user', content: `${entry.authorName}: ${content}` }
        );
    }

    return messages;
};

const callProvider = async (
    env: Env,
    messages: { role: string; content: string }[]
): Promise<{ reply: string; modelName: string }> => {
    const useGroq = env.AGENT_PROVIDER === 'groq';

    const baseUrl = useGroq ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1';
    const apiKey = useGroq ? env.GROQ_API_KEY : env.OPENROUTER_API_KEY;
    const model = env.AGENT_MODEL || (useGroq ? 'llama-3.3-70b-versatile' : 'minimax/minimax-m3:free');

    if (!apiKey) {
        throw new Error(
            `No API key configured for provider "${env.AGENT_PROVIDER}". ` +
            `Set it with: wrangler secret put ${useGroq ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY'}`
        );
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    if (!useGroq) {
        headers['X-Title'] = 'Potok';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature: 0.9 })
    });

    if (!response.ok) {
        throw new Error(`Provider returned ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as any;
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Provider returned an unexpected response shape');

    return { reply: String(reply).trim().slice(0, MAX_REPLY_LENGTH), modelName: model };
};

// --- HTTP ------------------------------------------------------------------

const corsHeaders = (env: Env, origin: string | null): Record<string, string> => {
    const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
    const isAllowed = origin !== null && allowed.includes(origin);

    return {
        'Access-Control-Allow-Origin': isAllowed ? origin : allowed[0] || '',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const origin = request.headers.get('Origin');
        const cors = corsHeaders(env, origin);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return json({ ok: true, provider: env.AGENT_PROVIDER, model: env.AGENT_MODEL }, 200, cors);
        }

        if (url.pathname !== '/agent-reply' || request.method !== 'POST') {
            return json({ error: 'Not found' }, 404, cors);
        }

        // Only signed-in users of this Firebase project may spend the shared key.
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

        if (!token) {
            return json({ error: 'Missing Firebase ID token' }, 401, cors);
        }

        try {
            await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
        } catch (error) {
            return json(
                { error: `Unauthorized: ${error instanceof Error ? error.message : String(error)}` },
                401,
                cors
            );
        }

        let body: AgentReplyRequest;
        try {
            body = (await request.json()) as AgentReplyRequest;
        } catch {
            return json({ error: 'Body must be JSON' }, 400, cors);
        }

        if (!body.agentName || !body.channelName || !Array.isArray(body.history)) {
            return json({ error: 'agentName, channelName and history are required' }, 400, cors);
        }

        try {
            const result = await callProvider(env, buildMessages(body));
            return json(result, 200, cors);
        } catch (error) {
            return json(
                { error: error instanceof Error ? error.message : String(error) },
                502,
                cors
            );
        }
    }
};
