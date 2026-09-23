import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCodeFiles, safePath } from '../services/codeSave';
import { parseAdvice } from '../services/runtime/advisor';
import { handleMcpRequest } from '../worker/src/mcpServer';
import { checkServerUrl } from '../worker/src/oauthConnect';
import { runOrchestration } from '../services/runtime/orchestrate';
import { AgentStore } from '../services/runtime/store';
import { EMPTY_SUMMARY } from '../services/memoryCore';

describe('extractCodeFiles', () => {
    it('names files from the fence, a first-line comment, or the language', () => {
        const text = [
            'Here:', '```ts src/app.ts', 'export const a = 1;', '```',
            '```python', '# tools/run.py', 'print(1)', '```',
            '```bash', 'echo hi', '```'
        ].join('\n');
        expect(extractCodeFiles(text)).toEqual([
            { path: 'src/app.ts', content: 'export const a = 1;\n' },
            { path: 'tools/run.py', content: 'print(1)\n' },
            { path: 'snippet-3.sh', content: 'echo hi\n' }
        ]);
    });

    it('never lets a path climb out of the chosen folder', () => {
        expect(safePath('../../etc/passwd')).toBe('etc/passwd');
        expect(safePath('C:\\a\\..\\b.txt')).toBe('C/a/b.txt');
    });
});

describe('parseAdvice', () => {
    const bots = [{ name: 'Writer', persona: '', tools: [] }];
    const candidates = [{ id: 'cloud-browser', name: 'Browser', description: '', needsConnection: false }];

    it('keeps suggestions about real bots and tools, drops the rest', () => {
        const raw = JSON.stringify({ suggestions: [
            { type: 'attach', reason: 'r', bot: '@writer', toolId: 'cloud-browser' },
            { type: 'attach', reason: 'r', bot: 'Ghost', toolId: 'cloud-browser' },
            { type: 'attach', reason: 'r', bot: 'Writer', toolId: 'nope' },
            { type: 'create_bot', reason: 'r', description: 'A researcher', toolIds: ['cloud-browser', 'nope'] },
            { type: 'custom_mcp', reason: 'r', spec: { name: 'my server!', description: 'd', tools: [{ name: 'do-it', description: 'x', params: 'y' }] } }
        ] });
        expect(parseAdvice(raw, bots, candidates)).toEqual([
            { type: 'attach', reason: 'r', bot: 'Writer', toolId: 'cloud-browser' },
            { type: 'create_bot', reason: 'r', description: 'A researcher', toolIds: ['cloud-browser'] },
            { type: 'custom_mcp', reason: 'r', spec: { name: 'my-server-', description: 'd', tools: [{ name: 'do_it', description: 'x', params: 'y' }] } }
        ]);
    });

    it('returns nothing for an unusable answer', () => {
        expect(parseAdvice('no json', bots, candidates)).toEqual([]);
    });
});

describe('worker MCP server', () => {
    const tools = [{ name: 'echo', description: 'e', inputSchema: { type: 'object' }, run: async (a: any) => `got ${a.x}` },
        { name: 'boom', description: 'b', inputSchema: { type: 'object' }, run: async () => { throw new Error('bad'); } }];
    const call = async (body: unknown) => {
        const r = await handleMcpRequest(new Request('https://w/tools', { method: 'POST', body: JSON.stringify(body) }), 's', tools, {});
        return r.status === 202 ? null : r.json();
    };

    it('answers the handshake, lists and runs tools', async () => {
        expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any).result.serverInfo.name).toBe('s');
        expect((await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as any).result.tools.map((t: any) => t.name)).toEqual(['echo', 'boom']);
        expect((await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 5 } } }) as any).result.content[0].text).toBe('got 5');
        expect((await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } }) as any).result.isError).toBe(true);
        expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    });
});

describe('OAuth connector', () => {
    it('only connects https servers', () => {
        expect(checkServerUrl('https://mcp.higgsfield.ai/mcp')).toBe('https://mcp.higgsfield.ai/mcp');
        expect(() => checkServerUrl('http://evil.local/mcp')).toThrow();
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('pausing a step', () => {
    it('gives a waiting step back to the same bot after the pause', async () => {
        const messages: any[] = [];
        const store: AgentStore = {
            getSummary: async () => EMPTY_SUMMARY, replaceSummary: async () => true,
            getMessagesSince: async () => [], postMessage: async m => { messages.push(m); },
            loadNotes: async () => [], addNote: async () => { }, setNoteEmbedding: async () => { },
            toolToken: async () => undefined
        };
        let calls = 0;
        const reply = (message: any) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
        vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
            const body = JSON.parse(init.body);
            const prompt = body.messages.at(-1).content as string;
            const system = body.messages[0].content as string;
            if (prompt.startsWith('ORCHESTRATOR_PLAN')) return reply({ content: '{"goal":"g","criteria":["c"],"steps":[{"bot":"A","instruction":"render","after":[]}]}' });
            if (prompt.startsWith('ORCHESTRATOR_FINAL')) return reply({ content: '{"answer":"ok","progress":100,"criteria":[{"met":true}]}' });
            if (body.messages.some((m: any) => m.role === 'tool')) return reply({ content: 'paused' });
            if (system.includes('[ПРОДОЛЖЕНИЕ]')) return reply({ content: 'video ready' });
            calls++;
            return reply({ content: null, tool_calls: [{ id: 'c1', function: { name: 'wait_and_resume', arguments: '{"seconds":1,"note":"job 7"}' } }] });
        }));
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 200 });

        const bot = { id: 'A', name: 'A', type: 'bot' as const, role: 'member' as const, addedAt: 0 };
        const run = runOrchestration({
            store, settings: { openRouterKey: 'k' } as any, boardId: 'b', channelId: 'c', channelName: 'g',
            bots: [bot], task: 't', maxSteps: 3, author: { id: 'u', name: 'U' }, toolPolicy: 'off'
        });
        await vi.advanceTimersByTimeAsync(40_000);
        const { state } = await run;
        vi.useRealTimers();

        expect(calls).toBe(1);
        expect(messages.some(m => String(m.content).startsWith('⏳ Жду 30 с: job 7'))).toBe(true);
        expect(state.log).toHaveLength(1);
        expect(state.log[0].result).toBe('video ready');
    });
});
