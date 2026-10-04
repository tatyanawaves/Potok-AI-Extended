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
 * call; the provider stops it on its own when idle. With `&board=<id>`,
 * Daytona instead gives each board a computer of its own that is never
 * deleted (POST /machine manages it).
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
    /** Puts a binary file into ~/attachments; returns its absolute path. */
    writeBytes(name: string, bytes: ArrayBuffer): Promise<string>;
}

/** A board id as Firestore makes them; anything else is refused before it reaches a key. */
export const BOARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const machineName = (uid: string, board: string) => `box:${uid}:daytona:board:${board}`;

interface DaytonaBox { id: string, toolbox: string }

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const daytonaAuth = (key: string) => ({ Authorization: `Bearer ${key}` });

/** The sandbox's state, or null once it is gone. */
const daytonaState = async (key: string, id: string): Promise<any | null> => {
    const r = await fetch(`${DAYTONA_API}/sandbox/${id}`, { headers: daytonaAuth(key) });
    if (r.status === 404) return null;
    if (!r.ok) await failed(r, 'Daytona');
    return r.json();
};

const GONE = ['destroyed', 'destroying', 'error', 'build_failed'];

/**
 * Finds the user's Daytona sandbox and makes sure it runs.
 *
 * Without a board it is a scratch sandbox: remembered for a while and deleted
 * by Daytona a couple of hours after it stops. With a board it is that board's
 * computer: stopped when idle, archived by Daytona after a while, but never
 * deleted and never forgotten, so files and installed packages stay until the
 * user deletes the machine.
 */
const ensureDaytona = async (env: SandboxEnv, uid: string, key: string, board?: string): Promise<DaytonaBox> => {
    const kv = env.CONNECTOR_TOKENS!;
    const name = board ? machineName(uid, board) : boxName(uid, 'daytona');
    const cached = await kv.get(name);
    let box: DaytonaBox | null = cached ? JSON.parse(cached) : null;

    if (box) {
        const s = await daytonaState(key, box.id);
        if (!s || GONE.includes(s.state)) box = null;
    }

    if (!box) {
        const r = await fetch(`${DAYTONA_API}/sandbox`, {
            method: 'POST',
            headers: { ...daytonaAuth(key), 'Content-Type': 'application/json' },
            body: JSON.stringify(board
                ? { labels: { app: 'potok', board }, autoStopInterval: 15, autoDeleteInterval: -1 }
                : { labels: { app: 'potok' }, autoStopInterval: 15, autoDeleteInterval: 120 })
        });
        if (!r.ok) await failed(r, 'Daytona: не удалось создать песочницу');
        const s: any = await r.json();
        box = { id: s.id, toolbox: String(s.toolboxProxyUrl || 'https://proxy.app.daytona.io/toolbox').replace(/\/$/, '') };
    }

    // A new or stopped sandbox takes a few seconds; an archived one longer.
    let started = false;
    for (let i = 0; i < 30 && !started; i++) {
        const s = await daytonaState(key, box.id);
        if (!s) throw new Error('Daytona: машина пропала, повторите команду');
        if (s.state === 'started') started = true;
        else if (s.state === 'error' || s.state === 'build_failed') throw new Error(`Daytona: ${s.errorReason || 'sandbox failed'}`);
        else {
            if (s.state === 'stopped' || s.state === 'archived') {
                await fetch(`${DAYTONA_API}/sandbox/${box.id}/start`, { method: 'POST', headers: daytonaAuth(key) });
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    if (!started) throw new Error('Daytona: машина ещё запускается, повторите через минуту');

    await kv.put(name, JSON.stringify(box), board ? undefined : { expirationTtl: REUSE_SECONDS });
    return box;
};

/** Drives a running Daytona sandbox through its toolbox API. */
const daytonaBackend = (key: string, box: DaytonaBox): Backend => {
    const base = `${box.toolbox}/${box.id}`;
    const call = async (path: string, init: RequestInit) => {
        const r = await fetch(`${base}${path}`, { ...init, headers: { ...daytonaAuth(key), ...(init.headers || {}) } });
        if (!r.ok) await failed(r, `Daytona ${path}`);
        return r;
    };
    const execute = async (command: string, timeout = 60) => {
        const out: any = await (await call('/process/execute', {
            // Through sh, so pipes, && and quotes work whatever the toolbox does with a bare command.
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: `sh -c ${shellQuote(command)}`, timeout })
        })).json();
        return { exitCode: Number(out.exitCode ?? 0), result: String(out.result || '') };
    };
    const upload = async (path: string, body: Blob) => {
        const form = new FormData();
        form.append('file', body, path.split('/').pop() || 'file');
        await call(`/files/upload-v2?path=${encodeURIComponent(path)}`, { method: 'POST', body: form });
    };
    let home: Promise<string> | null = null;
    const homeDir = () => (home ??= execute('echo $HOME').then(r => r.result.trim() || '/home/daytona'));
    // The file API takes paths as they are; "~" is the shell's, so it is expanded here.
    const expandHome = async (path: string) => /^~(\/|$)/.test(path) ? `${await homeDir()}${path.slice(1)}` : path;

    return {
        runCode: async (language, code) => {
            // Code runs as root, commands as the sandbox user: give the code
            // the user's home, or "~" in Python and in the shell are two places.
            const home = JSON.stringify(await homeDir());
            const prelude = language === 'python'
                ? `import os as _o; _o.environ['HOME'] = ${home}\ntry: _o.chdir(${home})\nexcept OSError: pass\n`
                : `process.env.HOME = ${home}; try { process.chdir(${home}); } catch {}\n`;
            const out: any = await (await call('/process/code-run', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language, code: prelude + code, timeout: 120 })
            })).json();
            return `exit ${out.exitCode ?? 0}\n${clip(String(out.result || ''))}`;
        },
        shell: async command => {
            const out = await execute(command);
            return `exit ${out.exitCode}\n${clip(out.result)}`;
        },
        writeFile: async (path, content) => {
            await upload(await expandHome(path), new Blob([content]));
            return `Saved ${path} (${content.length} chars)`;
        },
        readFile: async path => clip(await (await call(`/files/download?path=${encodeURIComponent(await expandHome(path))}`, { method: 'GET' })).text()),
        writeBytes: async (name, bytes) => {
            const path = `${await homeDir()}/attachments/${name}`;
            await upload(path, new Blob([bytes]));
            return path;
        }
    };
};

/** Lists one folder of the machine as JSON, for the board's "Компьютер" panel. */
const LIST_SCRIPT = [
    'import os, sys, json',
    "p = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~')",
    'out = []',
    'for e in sorted(os.scandir(p), key=lambda e: (not e.is_dir(), e.name.lower())):',
    '    try:',
    "        out.append({'name': e.name, 'dir': e.is_dir(), 'size': 0 if e.is_dir() else e.stat().st_size})",
    '    except OSError:',
    '        pass',
    "print(json.dumps({'path': os.path.abspath(p), 'entries': out[:500]}))"
].join('\n');

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

/**
 * Opens a port of the machine to the web and returns its address, so a site
 * or dashboard a bot started can be looked at. Daytona serves previews only
 * of public sandboxes to a plain browser, so the machine is made public: the
 * address is long and random, but anyone holding it can open any port until
 * closePreview.
 */
const openPreview = async (key: string, box: DaytonaBox, port: number): Promise<string> => {
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) throw new Error(`Порт должен быть числом от ${MIN_PORT} до ${MAX_PORT}`);
    const pub = await fetch(`${DAYTONA_API}/sandbox/${box.id}/public/true`, { method: 'POST', headers: daytonaAuth(key) });
    if (!pub.ok) await failed(pub, 'Daytona: не удалось открыть доступ');
    const r = await fetch(`${DAYTONA_API}/sandbox/${box.id}/ports/${port}/preview-url`, { headers: daytonaAuth(key) });
    if (!r.ok) await failed(r, 'Daytona: нет адреса для порта');
    const data: any = await r.json();
    if (!data.url) throw new Error('Daytona не вернул адрес');
    return String(data.url);
};

const closePreview = async (key: string, box: DaytonaBox): Promise<void> => {
    const r = await fetch(`${DAYTONA_API}/sandbox/${box.id}/public/false`, { method: 'POST', headers: daytonaAuth(key) });
    if (!r.ok) await failed(r, 'Daytona: не удалось закрыть доступ');
};

/**
 * POST /machine { board, action, path?, port? } — the board's computer, for its panel.
 * `status` never wakes the machine; `list`, `download` and `preview` do.
 */
export const handleMachine = async (
    request: Request, env: SandboxEnv, uid: string, json: Json, cors: Record<string, string>
): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    const board = String(body.board || '');
    if (!BOARD_ID.test(board)) return json({ error: 'board is required' }, 400);
    if (!env.CONNECTOR_TOKENS) return json({ error: 'Key storage is not enabled on this worker' }, 501);
    const key = await userKey(env, uid, 'daytona');
    if (!key) return json({ key: false }, 200);

    const kv = env.CONNECTOR_TOKENS;
    const cached = await kv.get(machineName(uid, board));
    const box: DaytonaBox | null = cached ? JSON.parse(cached) : null;
    const path = typeof body.path === 'string' && body.path ? body.path : '~';

    switch (body.action) {
        case 'status': {
            const s = box ? await daytonaState(key, box.id) : null;
            if (!s || GONE.includes(s.state)) return json({ key: true, exists: false }, 200);
            return json({ key: true, exists: true, state: s.state, cpu: s.cpu, memory: s.memory, disk: s.disk, public: Boolean(s.public) }, 200);
        }
        case 'list': {
            const backend = daytonaBackend(key, await ensureDaytona(env, uid, key, board));
            const out = (await backend.shell(`python3 -c ${shellQuote(LIST_SCRIPT)} ${shellQuote(path)}`)).replace(/^exit \d+\n/, '');
            try {
                return json({ key: true, exists: true, state: 'started', ...JSON.parse(out) }, 200);
            } catch {
                return json({ error: out.slice(0, 300) || 'Не удалось прочитать папку' }, 502);
            }
        }
        case 'download': {
            if (!box) return json({ error: 'У доски ещё нет компьютера' }, 404);
            const running = await ensureDaytona(env, uid, key, board);
            const r = await fetch(`${running.toolbox}/${running.id}/files/download?path=${encodeURIComponent(path)}`, { headers: daytonaAuth(key) });
            if (!r.ok) await failed(r, 'Daytona download');
            return new Response(r.body, { status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' } });
        }
        case 'preview': {
            const running = await ensureDaytona(env, uid, key, board);
            return json({ url: await openPreview(key, running, Number(body.port)) }, 200);
        }
        case 'unpublish': {
            if (box) await closePreview(key, box);
            return json({ ok: true }, 200);
        }
        case 'stop': {
            if (box) await fetch(`${DAYTONA_API}/sandbox/${box.id}/stop`, { method: 'POST', headers: daytonaAuth(key) });
            return json({ ok: true }, 200);
        }
        case 'delete': {
            if (box) {
                const r = await fetch(`${DAYTONA_API}/sandbox/${box.id}`, { method: 'DELETE', headers: daytonaAuth(key) });
                if (!r.ok && r.status !== 404) await failed(r, 'Daytona: не удалось удалить машину');
                await kv.delete(machineName(uid, board));
            }
            return json({ ok: true }, 200);
        }
        default:
            return json({ error: 'action must be status, list, download, preview, unpublish, stop or delete' }, 400);
    }
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
            // Python does not expand "~" by itself, as the shell does; without
            // this, ~/x.csv written here was a different file from ~/x.csv in a command.
            await execute(`import os\np = os.path.expanduser(${py(path)})\nos.makedirs(os.path.dirname(p) or ".", exist_ok=True)\nopen(p, "w", encoding="utf-8").write(${py(content)})`);
            return `Saved ${path} (${content.length} chars)`;
        },
        readFile: path => execute(`import os\nprint(open(os.path.expanduser(${py(path)}), encoding="utf-8").read())`),
        writeBytes: async (name, bytes) => {
            let binary = '';
            const view = new Uint8Array(bytes);
            for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
            const path = `/home/user/attachments/${name}`;
            await execute(`import os, base64
os.makedirs("/home/user/attachments", exist_ok=True)
open(${py(path)}, "wb").write(base64.b64decode(${py(btoa(binary))}))`);
            return path;
        }
    };
};

const backendFor = async (env: SandboxEnv, uid: string, provider: Provider, board?: string): Promise<Backend> => {
    const key = await userKey(env, uid, provider);
    if (!key) throw new Error(`Ключ ${provider === 'e2b' ? 'E2B' : 'Daytona'} не сохранён — добавьте его в Настройках Potok`);
    return provider === 'daytona' ? daytonaBackend(key, await ensureDaytona(env, uid, key, board)) : e2b(env, uid, key);
};

/** What the import tool needs: the board's files, and whether the caller may read them. */
export interface AttachmentSource {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    mayRead(board: string): Promise<boolean>;
}

/**
 * The sandbox as MCP tools. The backend is only created when a tool is called.
 * With a board, Daytona works on that board's own computer, which keeps its
 * files; E2B stays a scratch sandbox.
 */
export const sandboxTools = (
    env: SandboxEnv, uid: string, provider: Provider, board?: string, files?: AttachmentSource
): ServerTool[] => {
    let backend: Promise<Backend> | null = null;
    const get = () => (backend ??= backendFor(env, uid, provider, board));
    const persistent = provider === 'daytona' && Boolean(board);
    const lifetime = persistent
        ? "This is the board's own computer: files and installed packages stay between conversations, days apart."
        : 'State and files persist between calls for about 25 minutes.';

    const tools: ServerTool[] = [
        {
            name: 'sandbox_run_code',
            description: `Run Python or JavaScript in a private cloud sandbox and get the output. ${lifetime}`,
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

    if (persistent) {
        tools.push({
            name: 'sandbox_publish_port',
            description: "Open a port of the board's computer to the web and get its address, to show a site, app or dashboard you started (bind it to 0.0.0.0). Anyone with the address can open it until the owner closes access in the board's Computer panel.",
            inputSchema: { type: 'object', properties: { port: { type: 'number' } }, required: ['port'] },
            run: async a => {
                const key = await userKey(env, uid, 'daytona');
                if (!key) throw new Error('Ключ Daytona не сохранён');
                return `Preview: ${await openPreview(key, await ensureDaytona(env, uid, key, board), Number(a.port))}`;
            }
        });
    }

    if (board && files) {
        tools.push({
            name: 'sandbox_import_attachment',
            description: 'Copy a file attached in the board chat into the sandbox (~/attachments/<name>), to open it with code: PDF, Excel, images, archives, anything. Pass the key shown next to the attachment.',
            inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
            run: async a => {
                const key = String(a.key || '');
                if (!key.startsWith(`board/${board}/`)) throw new Error('Это вложение не из этой доски');
                if (!(await files.mayRead(board))) throw new Error('Нет доступа к файлам этой доски');
                const object = await files.get(key);
                if (!object) throw new Error('Вложение не найдено');
                const name = key.slice(key.lastIndexOf('/') + 1).replace(/^[0-9a-f-]{36}-/, '') || 'file';
                const path = await (await get()).writeBytes(name, await object.arrayBuffer());
                return `Saved ${path}`;
            }
        });
    }
    return tools;
};
