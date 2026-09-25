/**
 * Code sandboxes for bots — E2B or Daytona — on each user's own API key.
 *
 *   POST /keys/set      { provider, key }   validate and store the user's key
 *   POST /keys/status                        which providers the user has set up
 *   POST /keys/delete   { provider }
 *   POST /tools/sandbox?provider=e2b|daytona MCP: run code, shell, files
 *
 * Every user pays for their own sandboxes: the key is theirs, sealed in KV per
 * account (./taskCrypto), and only this worker opens it — never the page. So
 * the same tools work from a browser tab and from server tasks.
 *
 * One sandbox per user and provider is kept warm between calls (its id is
 * remembered for a while) so a bot can write a file and run it in the next
 * call; the provider stops it on its own when idle.
 */

import { seal, open } from './taskCrypto';
import type { KvLike } from './oauthConnect';
import type { ServerTool } from './mcpServer';
import { parseServiceAccount, validateGcp, type GcpConfig } from './cloudRun';

export type Provider = 'e2b' | 'daytona';
export const PROVIDERS: Provider[] = ['e2b', 'daytona'];

/** Every per-user key kept here: the two sandboxes, and Google Cloud for Cloud Run. */
export type KeyKind = Provider | 'gcp';
const KEY_KINDS: KeyKind[] = ['e2b', 'daytona', 'gcp'];
const isKeyKind = (value: unknown): value is KeyKind => KEY_KINDS.includes(value as KeyKind);
export const DEFAULT_GCP_REGION = 'europe-west1';

export interface SandboxEnv {
    CONNECTOR_TOKENS?: KvLike;
    TASK_SEALING_SECRET?: string;
    PIPEDREAM_CLIENT_SECRET?: string;
}

type Json = (body: unknown, status: number) => Response;

const secretOf = (env: SandboxEnv) => env.TASK_SEALING_SECRET || env.PIPEDREAM_CLIENT_SECRET || '';
const keyName = (uid: string, p: KeyKind) => `key:${uid}:${p}`;
const boxName = (uid: string, p: Provider) => `box:${uid}:${p}`;
/** How long a sandbox id is reused; the provider's own idle timeout is similar. */
const REUSE_SECONDS = 25 * 60;
const MAX_OUTPUT = 8000;

const DAYTONA_API = 'https://app.daytona.io/api';
const E2B_API = 'https://api.e2b.app';
const E2B_TEMPLATE = 'code-interpreter-v1';

export const isProvider = (value: unknown): value is Provider => PROVIDERS.includes(value as Provider);

const clip = (text: string) => text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text;

const failed = async (r: Response, what: string): Promise<never> => {
    const body: any = await r.json().catch(() => ({}));
    throw new Error(`${what}: ${body.message || body.error || r.status}`);
};

/** A cheap authenticated read: a wrong key is refused here, not in the middle of a task. */
const validateKey = async (provider: Provider, key: string): Promise<void> => {
    const r = provider === 'daytona'
        ? await fetch(`${DAYTONA_API}/sandbox?limit=1`, { headers: { Authorization: `Bearer ${key}` } })
        : await fetch(`${E2B_API}/sandboxes`, { headers: { 'X-API-KEY': key } });
    if (!r.ok) await failed(r, provider === 'daytona' ? 'Daytona не принял ключ' : 'E2B не принял ключ');
};

export const handleKeySet = async (request: Request, env: SandboxEnv, uid: string, json: Json): Promise<Response> => {
    if (!env.CONNECTOR_TOKENS || !secretOf(env)) return json({ error: 'Key storage is not enabled on this worker' }, 501);
    const body: any = await request.json().catch(() => ({}));
    if (!isKeyKind(body.provider) || typeof body.key !== 'string' || !body.key.trim()) {
        return json({ error: 'provider (e2b|daytona|gcp) and key are required' }, 400);
    }

    let stored = body.key.trim();
    if (body.provider === 'gcp') {
        // The JSON key plus the region deployments go to; checked for real.
        const region = /^[a-z]+-[a-z]+\d$/.test(String(body.region || '')) ? String(body.region) : DEFAULT_GCP_REGION;
        const config: GcpConfig = { account: parseServiceAccount(stored), region };
        await validateGcp(config);
        stored = JSON.stringify(config);
    } else {
        await validateKey(body.provider, stored);
    }
    await env.CONNECTOR_TOKENS.put(keyName(uid, body.provider), await seal(stored, secretOf(env)));
    return json({ ok: true }, 200);
};

export const handleKeyStatus = async (_request: Request, env: SandboxEnv, uid: string, json: Json): Promise<Response> => {
    const status: Record<string, boolean> = {};
    for (const p of KEY_KINDS) status[p] = Boolean(await env.CONNECTOR_TOKENS?.get(keyName(uid, p)));
    return json(status, 200);
};

export const handleKeyDelete = async (request: Request, env: SandboxEnv, uid: string, json: Json): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    if (!isKeyKind(body.provider)) return json({ error: 'provider is required' }, 400);
    await env.CONNECTOR_TOKENS?.delete(keyName(uid, body.provider));
    if (isProvider(body.provider)) await env.CONNECTOR_TOKENS?.delete(boxName(uid, body.provider));
    return json({ ok: true }, 200);
};

/** The user's Cloud Run configuration, or an error that says how to add it. */
export const userGcp = async (env: SandboxEnv, uid: string): Promise<GcpConfig> => {
    const sealed = await env.CONNECTOR_TOKENS?.get(keyName(uid, 'gcp'));
    if (!sealed) throw new Error('Google Cloud не подключён — добавьте ключ сервисного аккаунта в Настройках Potok');
    return JSON.parse(await open<string>(sealed, secretOf(env))) as GcpConfig;
};

export const userKey = async (env: SandboxEnv, uid: string, provider: Provider): Promise<string | null> => {
    const sealed = await env.CONNECTOR_TOKENS?.get(keyName(uid, provider));
    return sealed ? open<string>(sealed, secretOf(env)) : null;
};

// --- Providers ------------------------------------------------------------------------

interface Backend {
    runCode(language: string, code: string): Promise<string>;
    shell(command: string): Promise<string>;
    writeFile(path: string, content: string): Promise<string>;
    readFile(path: string): Promise<string>;
}

/** Daytona: create a sandbox, then drive it through its toolbox API. */
const daytona = async (env: SandboxEnv, uid: string, key: string): Promise<Backend> => {
    const auth = { Authorization: `Bearer ${key}` };
    const kv = env.CONNECTOR_TOKENS!;

    const cached = await kv.get(boxName(uid, 'daytona'));
    let box: { id: string, toolbox: string } | null = cached ? JSON.parse(cached) : null;

    if (box) {
        // Stopped by its idle timer since: start it again rather than make a new one.
        const r = await fetch(`${DAYTONA_API}/sandbox/${box.id}`, { headers: auth });
        if (!r.ok) box = null;
        else {
            const s: any = await r.json();
            if (s.state === 'stopped') await fetch(`${DAYTONA_API}/sandbox/${box.id}/start`, { method: 'POST', headers: auth });
            else if (!['started', 'starting'].includes(s.state)) box = null;
        }
    }

    if (!box) {
        const r = await fetch(`${DAYTONA_API}/sandbox`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels: { app: 'potok' }, autoStopInterval: 15, autoDeleteInterval: 120 })
        });
        if (!r.ok) await failed(r, 'Daytona: не удалось создать песочницу');
        const s: any = await r.json();
        box = { id: s.id, toolbox: String(s.toolboxProxyUrl || 'https://proxy.app.daytona.io/toolbox').replace(/\/$/, '') };
    }

    // A fresh sandbox takes a few seconds to come up.
    for (let i = 0; i < 20; i++) {
        const s: any = await (await fetch(`${DAYTONA_API}/sandbox/${box.id}`, { headers: auth })).json();
        if (s.state === 'started') break;
        if (s.state === 'error') throw new Error(`Daytona: ${s.errorReason || 'sandbox failed'}`);
        await new Promise(r => setTimeout(r, 1500));
    }
    await kv.put(boxName(uid, 'daytona'), JSON.stringify(box), { expirationTtl: REUSE_SECONDS });

    const base = `${box.toolbox}/${box.id}`;
    const call = async (path: string, init: RequestInit) => {
        const r = await fetch(`${base}${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });
        if (!r.ok) await failed(r, `Daytona ${path}`);
        return r;
    };
    const execute = async (command: string, timeout = 60) => {
        const out: any = await (await call('/process/execute', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, timeout })
        })).json();
        return `exit ${out.exitCode ?? 0}\n${clip(String(out.result || ''))}`;
    };

    return {
        runCode: async (language, code) => {
            const out: any = await (await call('/process/code-run', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language, code, timeout: 120 })
            })).json();
            return `exit ${out.exitCode ?? 0}\n${clip(String(out.result || ''))}`;
        },
        shell: command => execute(command),
        writeFile: async (path, content) => {
            const form = new FormData();
            form.append('file', new Blob([content]), path.split('/').pop() || 'file');
            await call(`/files/upload-v2?path=${encodeURIComponent(path)}`, { method: 'POST', body: form });
            return `Saved ${path} (${content.length} chars)`;
        },
        readFile: async path => clip(await (await call(`/files/download?path=${encodeURIComponent(path)}`, { method: 'GET' })).text())
    };
};

/**
 * E2B: a code-interpreter sandbox; code runs through its Jupyter server, and
 * shell and file work go through Python, which keeps to plain HTTP.
 */
const e2b = async (env: SandboxEnv, uid: string, key: string): Promise<Backend> => {
    const kv = env.CONNECTOR_TOKENS!;
    const cached = await kv.get(boxName(uid, 'e2b'));
    let box: { id: string, domain: string, token?: string } | null = cached ? JSON.parse(cached) : null;

    if (box) {
        // Keep it alive for another stretch; a vanished sandbox is replaced.
        const r = await fetch(`${E2B_API}/sandboxes/${box.id}/timeout`, {
            method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeout: REUSE_SECONDS })
        });
        if (!r.ok) box = null;
    }
    if (!box) {
        const r = await fetch(`${E2B_API}/sandboxes`, {
            method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateID: E2B_TEMPLATE, timeout: REUSE_SECONDS, metadata: { app: 'potok' } })
        });
        if (!r.ok) await failed(r, 'E2B: не удалось создать песочницу');
        const s: any = await r.json();
        box = { id: s.sandboxID, domain: s.domain || 'e2b.app', token: s.envdAccessToken };
    }
    await kv.put(boxName(uid, 'e2b'), JSON.stringify(box), { expirationTtl: REUSE_SECONDS });

    const execute = async (code: string, language = 'python'): Promise<string> => {
        const r = await fetch(`https://49999-${box!.id}.${box!.domain}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(box!.token ? { 'X-Access-Token': box!.token } : {}) },
            body: JSON.stringify({ code, language })
        });
        if (!r.ok) await failed(r, 'E2B execute');
        // The answer is a stream of JSON lines: output, results, errors.
        const parts: string[] = [];
        for (const line of (await r.text()).split('\n')) {
            if (!line.trim()) continue;
            try {
                const m = JSON.parse(line);
                if (m.type === 'stdout' || m.type === 'stderr') parts.push(m.text);
                else if (m.type === 'result') parts.push(m.text || m.markdown || JSON.stringify(m.json ?? ''));
                else if (m.type === 'error') parts.push(`${m.name}: ${m.value}\n${m.traceback || ''}`);
            } catch { /* keep-alives */ }
        }
        return clip(parts.join('') || '(no output)');
    };
    const py = (s: string) => JSON.stringify(s);

    return {
        runCode: (language, code) => execute(code, language === 'javascript' || language === 'typescript' ? 'js' : 'python'),
        shell: command => execute(`import subprocess\nr = subprocess.run(${py(command)}, shell=True, capture_output=True, text=True, timeout=120)\nprint("exit", r.returncode)\nprint(r.stdout + r.stderr)`),
        writeFile: async (path, content) => {
            await execute(`import os\nos.makedirs(os.path.dirname(${py(path)}) or ".", exist_ok=True)\nopen(${py(path)}, "w", encoding="utf-8").write(${py(content)})`);
            return `Saved ${path} (${content.length} chars)`;
        },
        readFile: path => execute(`print(open(${py(path)}, encoding="utf-8").read())`)
    };
};

const backendFor = async (env: SandboxEnv, uid: string, provider: Provider): Promise<Backend> => {
    const key = await userKey(env, uid, provider);
    if (!key) throw new Error(`Ключ ${provider === 'e2b' ? 'E2B' : 'Daytona'} не сохранён — добавьте его в Настройках Potok`);
    return provider === 'daytona' ? daytona(env, uid, key) : e2b(env, uid, key);
};

/** The sandbox as MCP tools. The backend is only created when a tool is called. */
export const sandboxTools = (env: SandboxEnv, uid: string, provider: Provider): ServerTool[] => {
    let backend: Promise<Backend> | null = null;
    const get = () => (backend ??= backendFor(env, uid, provider));
    return [
        {
            name: 'sandbox_run_code',
            description: 'Run Python or JavaScript in a private cloud sandbox and get the output. State and files persist between calls for about 25 minutes.',
            inputSchema: {
                type: 'object',
                properties: {
                    language: { type: 'string', enum: ['python', 'javascript'] },
                    code: { type: 'string' }
                },
                required: ['code']
            },
            run: async a => (await get()).runCode(String(a.language || 'python'), String(a.code || ''))
        },
        {
            name: 'sandbox_shell',
            description: 'Run a shell command in the sandbox (install packages, run scripts, git clone, build).',
            inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
            run: async a => (await get()).shell(String(a.command || ''))
        },
        {
            name: 'sandbox_write_file',
            description: 'Create or overwrite a text file in the sandbox.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
            run: async a => (await get()).writeFile(String(a.path || ''), String(a.content ?? ''))
        },
        {
            name: 'sandbox_read_file',
            description: 'Read a text file from the sandbox.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            run: async a => (await get()).readFile(String(a.path || ''))
        }
    ];
};
