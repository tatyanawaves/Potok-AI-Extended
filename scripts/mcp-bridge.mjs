#!/usr/bin/env node
/**
 * MCP bridge: gives the bots in the browser a tool server that runs on this
 * machine — in a Docker container, or any local program.
 *
 * Most MCP servers speak over stdio: they are programs you start, not URLs.
 * The browser can only make HTTP requests, and only to servers that allow its
 * origin. This bridge starts the program, and serves it as MCP over
 * Streamable HTTP on 127.0.0.1 with the right CORS headers.
 *
 *   npm run bridge -- [options] -- <command> [args...]
 *
 *   npm run bridge -- --port 8931 -- docker run -i --rm mcp/fetch
 *   npm run bridge -- --port 8932 -- npx -y @playwright/mcp@latest --headless --browser chrome
 *   npm run bridge -- --port 8933 -- docker run -i --rm -v %cd%:/work mcp/filesystem /work
 *
 * Options:
 *   --port <n>        port on 127.0.0.1 (default 8931)
 *   --token <secret>  required bearer token (default: a random one, printed)
 *   --no-token        no token — only for trying things out
 *   --origin <list>   comma-separated origins allowed to call (default: the
 *                     deployed site and local dev servers); "*" for any
 *
 * Then give a bot the tool server http://127.0.0.1:<port>/mcp, and put the
 * token in Settings → MCP tokens for that URL.
 *
 * Why the token: any web page you open could otherwise send requests to
 * 127.0.0.1 and drive whatever the bridge runs — a browser, a shell, your
 * files. The origin check stops other sites; the token stops everything that
 * does not have it.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const options = split >= 0 ? argv.slice(0, split) : argv;
const command = split >= 0 ? argv.slice(split + 1) : [];

const option = (name, fallback) => {
    const i = options.indexOf(name);
    return i >= 0 ? options[i + 1] : fallback;
};

if (command.length === 0) {
    console.error('Usage: npm run bridge -- [--port 8931] [--token T] [--origin list] -- <command> [args...]');
    process.exit(1);
}

const port = Number(option('--port', 8931));
const token = options.includes('--no-token') ? null : option('--token', randomBytes(18).toString('base64url'));
const DEFAULT_ORIGINS = [
    'https://neon-extended.web.app',
    'https://neon-extended.firebaseapp.com',
    'https://localhost:3000', 'http://localhost:3000',
    'http://localhost:3001', 'http://127.0.0.1:3001'
];
const origins = (option('--origin', DEFAULT_ORIGINS.join(','))).split(',').map(o => o.trim()).filter(Boolean);
const REQUEST_TIMEOUT_MS = 180_000;

// --- The child MCP server ---------------------------------------------------------

const child = spawn(command[0], command.slice(1), {
    stdio: ['pipe', 'pipe', 'inherit'],
    // npx and docker are .cmd shims on Windows and need a shell to start.
    shell: process.platform === 'win32'
});

child.on('exit', code => {
    console.error(`[bridge] server exited (${code}); stopping.`);
    process.exit(code ?? 1);
});

const pending = new Map();
let nextId = 1;

const writeToChild = (message) => child.stdin.write(JSON.stringify(message) + '\n');

readline.createInterface({ input: child.stdout }).on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; } // servers may log to stdout

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const waiter = pending.get(message.id);
        if (waiter) { pending.delete(message.id); waiter(message); }
        return;
    }

    // A request from the server to the client (sampling, roots, elicitation).
    // The browser side cannot answer those; declining keeps the server from
    // waiting forever.
    if (message.id !== undefined && message.method) {
        writeToChild({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported by the bridge' } });
    }
});

/** Sends a request to the server under a bridge-unique id and awaits the answer. */
const ask = (message) => new Promise((resolve, reject) => {
    const id = `b${nextId++}`;
    const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`No answer from the server within ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
    writeToChild({ ...message, id });
});

// One server process is shared by every browser tab, but it can only be
// initialised once: the first handshake is performed and remembered, later
// ones are answered from it.
let initialized = null;
let initializedNotified = false;

const handle = async (message) => {
    if (message.method === 'initialize') {
        if (!initialized) initialized = ask(message);
        const reply = await initialized;
        return { ...reply, id: message.id };
    }
    const reply = await ask(message);
    return { ...reply, id: message.id };
};

// --- HTTP ---------------------------------------------------------------------------

const corsHeaders = (origin) => ({
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    // Chrome asks before a public site may reach a private address.
    'Access-Control-Allow-Private-Network': 'true'
});

const allowedOrigin = (origin) => !origin || origins.includes('*') || origins.includes(origin);

http.createServer((req, res) => {
    const origin = req.headers.origin;
    const headers = origin && allowedOrigin(origin) ? corsHeaders(origin) : {};

    const reply = (status, body, extra = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers, ...extra });
        res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (!allowedOrigin(origin)) return reply(403, { error: `Origin ${origin} is not allowed; start the bridge with --origin` });
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
    if (req.method !== 'POST' || !req.url.startsWith('/mcp')) return reply(404, { error: 'POST /mcp' });

    if (token && req.headers.authorization !== `Bearer ${token}`) {
        return reply(401, { error: 'Missing or wrong bridge token (Settings → MCP tokens)' });
    }

    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
        let message;
        try { message = JSON.parse(raw); } catch { return reply(400, { error: 'Bad JSON' }); }

        // Notifications get no answer. The "initialized" one is forwarded once,
        // like the handshake it belongs to.
        if (message.id === undefined) {
            if (message.method === 'notifications/initialized') {
                if (!initializedNotified) { initializedNotified = true; writeToChild(message); }
            } else {
                writeToChild(message);
            }
            res.writeHead(202, headers);
            return res.end();
        }

        try {
            reply(200, await handle(message), { 'Mcp-Session-Id': 'bridge' });
        } catch (error) {
            reply(200, { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: String(error.message || error) } });
        }
    });
}).listen(port, '127.0.0.1', () => {
    console.log(`[bridge] ${command.join(' ')}`);
    console.log(`[bridge] tool server:  http://127.0.0.1:${port}/mcp`);
    console.log(token ? `[bridge] token:        ${token}` : '[bridge] no token required (--no-token)');
    console.log(`[bridge] origins:      ${origins.join(', ')}`);
});
