import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { connect, callTool } from '../services/mcp';

const PORT = 18931;
const TOKEN = 'test-token';
const URL = `http://127.0.0.1:${PORT}/mcp`;
let bridge: ChildProcess;

const post = (body: unknown, headers: Record<string, string> = {}) => fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body)
});

beforeAll(async () => {
    bridge = spawn(process.execPath, [
        path.resolve('scripts/mcp-bridge.mjs'), '--port', String(PORT), '--token', TOKEN,
        '--', process.execPath, path.resolve('test/fixtures/stdio-mcp.mjs')
    ], { stdio: ['ignore', 'pipe', 'inherit'] });

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bridge did not start')), 10_000);
        bridge.stdout!.on('data', chunk => {
            if (String(chunk).includes('tool server')) { clearTimeout(timer); resolve(); }
        });
    });
});

afterAll(() => { bridge?.kill(); });

describe('mcp-bridge', () => {
    it('serves a stdio server to the real browser client', async () => {
        const connection = await connect(URL, TOKEN);
        expect(connection.tools.map(t => t.name)).toEqual(['echo', 'init_count']);
        expect(await callTool(connection, 'echo', { a: 1 }, TOKEN)).toBe('{"a":1}');
    });

    it('initialises the server once however many clients connect', async () => {
        await connect(URL, TOKEN);
        const connection = await connect(URL, TOKEN);
        expect(await callTool(connection, 'init_count', {}, TOKEN)).toBe('1');
    });

    it('refuses a request without the token', async () => {
        const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong' });
        expect(response.status).toBe(401);
    });

    it('refuses an origin that is not allowed', async () => {
        const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'https://evil.example' });
        expect(response.status).toBe(403);
    });

    it('allows the deployed site, including Chrome\'s private-network preflight', async () => {
        const response = await fetch(URL, {
            method: 'OPTIONS',
            headers: { Origin: 'https://neon-extended.web.app', 'Access-Control-Request-Private-Network': 'true' }
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://neon-extended.web.app');
        expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    });
});
