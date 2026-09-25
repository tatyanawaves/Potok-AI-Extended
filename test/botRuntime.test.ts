import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentStore } from '../services/runtime/store';
import { runBotTurn, isDestructiveTool, replyOrNotice, resetToolConnections, probeToolServer } from '../services/runtime/turn';
import { setMcpFetch } from '../services/mcp';
import { isFatalProviderError } from '../services/llm';
import { interleave, selectTools, EMPTY_SUMMARY } from '../services/memoryCore';
import { mentionableName, freeName, parseMentions } from '../services/mentions';
import { toSavedBot, upsertSavedBot, MAX_SAVED_BOTS } from '../services/botLibraryCore';
import { BoardMember } from '../types';

// --- A fake MCP server and model -------------------------------------------------

interface FakeTool { name: string, description?: string, annotations?: Record<string, boolean> }

/** Serves JSON-RPC for any number of fake servers, keyed by URL. */
const fakeMcp = (servers: Record<string, {
    tools: FakeTool[],
    call?: (name: string, args: any, session: string | null, token: string | null) => string | Response,
    /** Sessions the server still knows; others get a 404. */
    sessions?: Set<string>
}>) => {
    const log: Array<{ url: string, method: string, session: string | null, token: string | null }> = [];
    let sessionCounter = 0;
    setMcpFetch(async (url, init) => {
        const server = servers[url];
        const body = JSON.parse(String(init.body));
        const headers = new Headers(init.headers as Record<string, string>);
        const session = headers.get('mcp-session-id');
        const token = headers.get('authorization');
        log.push({ url, method: body.method, session, token });
        if (!server) return new Response('no such server', { status: 404 });

        if (body.method === 'initialize') {
            const id = `s${++sessionCounter}`;
            server.sessions?.add(id);
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
                status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': id }
            });
        }
        if (server.sessions && session && !server.sessions.has(session)) {
            return new Response('session not found', { status: 404 });
        }
        if (body.id === undefined) return new Response(null, { status: 202 });
        if (body.method === 'tools/list') {
            return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: server.tools.map(t => ({ inputSchema: { type: 'object' }, ...t })) } });
        }
        if (body.method === 'tools/call') {
            const out = server.call?.(body.params.name, body.params.arguments, session, token) ?? 'ok';
            if (out instanceof Response) return out;
            return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: out }] } });
        }
        return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'unknown' } });
    });
    return log;
};

const store = (tokens: Record<string, string> = {}): AgentStore => ({
    getSummary: async () => EMPTY_SUMMARY,
    replaceSummary: async () => true,
    getMessagesSince: async () => [],
    postMessage: async () => { },
    loadNotes: async () => [],
    addNote: async () => { },
    setNoteEmbedding: async () => { },
    toolToken: async url => tokens[url]
});

const bot = (urls: string[]): BoardMember => ({
    id: 'bot', name: 'Worker', type: 'bot', role: 'member', addedAt: 0,
    toolServerUrl: urls[0], toolServerUrls: urls.slice(1)
});

/** A model that plays back a script of replies and records what it was offered. */
const fakeModel = (script: Array<{ content?: string | null, tool_calls?: any[] }>) => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        requests.push(body);
        const message = script[Math.min(requests.length - 1, script.length - 1)];
        return Response.json({ choices: [{ message: { content: null, ...message } }], usage: { total_tokens: 1 } });
    }));
    return requests;
};

const call = (name: string, args: object, id = name) =>
    ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

const settings = { openRouterKey: 'k', openRouterModel: 'm' } as any;

afterEach(() => {
    vi.unstubAllGlobals();
    resetToolConnections();
    setMcpFetch((url, init) => fetch(url, init));
});

// --- Tool offering ---------------------------------------------------------------

describe('tools offered to a bot', () => {
    it('always includes the built-in tools and gives every server a share', async () => {
        fakeMcp({
            'https://big/mcp': { tools: Array.from({ length: 20 }, (_, i) => ({ name: `big_tool_${i}`, description: 'Does a thing.' })) },
            'https://small/mcp': { tools: [{ name: 'small_search' }, { name: 'small_fetch' }] }
        });
        const requests = fakeModel([{ content: 'done' }]);

        await runBotTurn({
            store: store(), agent: bot(['https://big/mcp', 'https://small/mcp']), boardId: 'b', channelId: 'c',
            channelName: 'g', settings, assignment: { goal: 'g', instruction: 'Сделай отчёт', step: 1, totalSteps: 1 }
        });

        const offered: string[] = requests[0].tools.map((t: any) => t.function.name);
        expect(offered).toEqual(expect.arrayContaining(['memory_remember', 'memory_recall', 'wait_and_resume', 'small_search', 'small_fetch']));
        expect(requests[0].temperature).toBeLessThanOrEqual(0.3);
    });

    it('shares free slots between groups in turn', () => {
        const items = ['a1', 'a2', 'a3', 'b1', 'c1', 'c2'];
        expect(interleave(items, x => x[0])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
        const tools = items.map(name => ({ name }));
        expect(selectTools(tools, 'nothing matches', 3, t => t.name[0]).map(t => t.name)).toEqual(['a1', 'b1', 'c1']);
    });
});

// --- Calling tools ----------------------------------------------------------------

describe('tool calls', () => {
    it('asks before a destructive tool on a mention, and runs harmless ones freely', async () => {
        const ran: string[] = [];
        fakeMcp({
            'https://run/mcp': {
                tools: [{ name: 'cloudrun_list_services' }, { name: 'cloudrun_delete_service' }],
                call: name => { ran.push(name); return 'ok'; }
            }
        });
        fakeModel([
            { tool_calls: [call('cloudrun_list_services', {}), call('cloudrun_delete_service', { service: 'x' })] },
            { content: 'готово' }
        ]);
        const asked: string[] = [];

        const result = await runBotTurn({
            store: store(), agent: bot(['https://run/mcp']), boardId: 'b', channelId: 'c', channelName: 'g', settings,
            toolPolicy: 'auto', confirmDestructive: true,
            approveTool: async (_bot, tool) => { asked.push(tool); return false; }
        });

        expect(asked).toEqual(['cloudrun_delete_service']);
        expect(ran).toEqual(['cloudrun_list_services']);
        expect(result.toolsUsed).toEqual(['cloudrun_list_services']);
    });

    it('lets a model retry a call that failed instead of replaying the error', async () => {
        let attempts = 0;
        fakeMcp({
            'https://flaky/mcp': {
                tools: [{ name: 'lookup' }],
                call: () => ++attempts === 1
                    ? Response.json({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'busy' }] } })
                    : 'found it'
            }
        });
        const requests = fakeModel([
            { tool_calls: [call('lookup', { q: 1 }, 'a')] },
            { tool_calls: [call('lookup', { q: 1 }, 'b')] },
            { content: 'ok' }
        ]);

        await runBotTurn({ store: store(), agent: bot(['https://flaky/mcp']), boardId: 'b', channelId: 'c', channelName: 'g', settings });

        expect(attempts).toBe(2);
        const toolReplies = requests[2].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content);
        expect(toolReplies).toEqual(['Error: busy', 'found it']);
    });

    it('does not count a tool the model made up as used', async () => {
        fakeMcp({ 'https://one/mcp': { tools: [{ name: 'real_tool' }] } });
        fakeModel([{ tool_calls: [call('imaginary_tool', {})] }, { content: 'ok' }]);
        const result = await runBotTurn({ store: store(), agent: bot(['https://one/mcp']), boardId: 'b', channelId: 'c', channelName: 'g', settings });
        expect(result.toolsUsed).toEqual([]);
    });

    it('starts a new session when the server forgot the old one', async () => {
        const sessions = new Set<string>();
        const log = fakeMcp({ 'https://stateful/mcp': { tools: [{ name: 'lookup' }], sessions, call: () => 'fresh answer' } });
        fakeModel([{ tool_calls: [call('lookup', {})] }, { content: 'ok' }]);

        await probeToolServer('https://stateful/mcp', store());
        sessions.clear();   // the server restarted

        const requests = fakeModel([{ tool_calls: [call('lookup', {})] }, { content: 'ok' }]);
        await runBotTurn({ store: store(), agent: bot(['https://stateful/mcp']), boardId: 'b', channelId: 'c', channelName: 'g', settings });

        expect(log.filter(l => l.method === 'initialize')).toHaveLength(2);
        expect(requests[1].messages.find((m: any) => m.role === 'tool').content).toBe('fresh answer');
    });

    it('never runs a tool twice because its own error mentions a session', async () => {
        let runs = 0;
        const log = fakeMcp({
            'https://deploy/mcp': {
                tools: [{ name: 'deploy_site' }], sessions: new Set(),
                call: () => { runs++; return Response.json({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'build session timed out' }] } }); }
            }
        });
        fakeModel([{ tool_calls: [call('deploy_site', {})] }, { content: 'ok' }]);
        await runBotTurn({ store: store(), agent: bot(['https://deploy/mcp']), boardId: 'b', channelId: 'c', channelName: 'g', settings });
        expect(runs).toBe(1);
        expect(log.filter(l => l.method === 'initialize')).toHaveLength(1);
    });

    it('keeps users apart even on a server that takes no token', async () => {
        const log = fakeMcp({ 'https://public/mcp': { tools: [{ name: 'lookup' }] } });
        fakeModel([{ content: 'ok' }]);
        const agent = bot(['https://public/mcp']);
        await runBotTurn({ store: { ...store(), scope: 'alice' }, agent, boardId: 'b', channelId: 'c', channelName: 'g', settings });
        await runBotTurn({ store: { ...store(), scope: 'bob' }, agent, boardId: 'b', channelId: 'c', channelName: 'g', settings });
        expect(log.filter(l => l.method === 'initialize')).toHaveLength(2);
    });

    it('never reuses one user\'s session for another user\'s token', async () => {
        const log = fakeMcp({ 'https://shared/mcp': { tools: [{ name: 'lookup' }] } });
        fakeModel([{ content: 'ok' }]);
        const agent = bot(['https://shared/mcp']);

        await runBotTurn({ store: store({ 'https://shared/mcp': 'alice' }), agent, boardId: 'b', channelId: 'c', channelName: 'g', settings });
        await runBotTurn({ store: store({ 'https://shared/mcp': 'bob' }), agent, boardId: 'b', channelId: 'c', channelName: 'g', settings });
        await runBotTurn({ store: store({ 'https://shared/mcp': 'alice' }), agent, boardId: 'b', channelId: 'c', channelName: 'g', settings });

        expect(log.filter(l => l.method === 'initialize').map(l => l.token)).toEqual(['Bearer alice', 'Bearer bob']);
    });
});

describe('isDestructiveTool', () => {
    it('reads the server\'s hints first, then the name', () => {
        expect(isDestructiveTool({ name: 'cloudrun_delete_service', inputSchema: {} })).toBe(true);
        expect(isDestructiveTool({ name: 'deleteRecord', inputSchema: {} })).toBe(true);
        expect(isDestructiveTool({ name: 'browser_run_code_unsafe', inputSchema: {} })).toBe(true);
        expect(isDestructiveTool({ name: 'list_deleted_items', inputSchema: {}, annotations: { readOnlyHint: true } })).toBe(false);
        expect(isDestructiveTool({ name: 'sync', inputSchema: {}, annotations: { destructiveHint: true } })).toBe(true);
        expect(isDestructiveTool({ name: 'search_issues', inputSchema: {} })).toBe(false);
        expect(isDestructiveTool({ name: 'model_selector', inputSchema: {} })).toBe(false);
    });
});

// --- Replies and errors -----------------------------------------------------------

describe('replies', () => {
    it('keeps long answers whole up to a generous limit and says when it cut one', () => {
        const code = 'x'.repeat(5000);
        expect(replyOrNotice(code)).toBe(code);
        const huge = replyOrNotice('y'.repeat(20000));
        expect(huge.length).toBeLessThanOrEqual(8000);
        expect(huge).toMatch(/обрезан/);
    });

    it('stops on the balance, not on one rejected request', () => {
        expect(isFatalProviderError(new Error('HTTP 400: провайдер отклонил запрос: context too long'))).toBe(false);
        expect(isFatalProviderError(new Error('HTTP 402: на ключе закончился баланс'))).toBe(true);
    });
});

// --- Names and saved bots -----------------------------------------------------------

describe('bot names', () => {
    it('makes names that an @mention finds again', () => {
        expect(mentionableName('Аналитик данных')).toBe('Аналитик_данных');
        expect(mentionableName('@Dr. Who!')).toBe('Dr_Who');
        expect(parseMentions(`@${mentionableName('Аналитик данных')} привет`)).toEqual(['Аналитик_данных']);
        expect(mentionableName('   ')).toBe('');
    });

    it('picks the first free variant of a name', () => {
        expect(freeName('Critic', ['Analyst'])).toBe('Critic');
        expect(freeName('Critic', ['critic', 'Critic2'])).toBe('Critic3');
    });
});

describe('my bots', () => {
    const member: BoardMember = {
        id: 'x', name: 'Researcher', type: 'bot', role: 'member', addedAt: 0,
        systemPrompt: 'You research.', model: 'some/model',
        toolServerUrl: 'https://a/mcp', toolServerUrls: ['https://b/mcp', 'https://a/mcp']
    };

    it('keeps the prompt, model and tool servers of a bot', () => {
        const saved = toSavedBot(member, 5);
        expect(saved).toMatchObject({ name: 'Researcher', systemPrompt: 'You research.', model: 'some/model', toolServerUrls: ['https://a/mcp', 'https://b/mcp'], savedAt: 5 });
    });

    it('updates a bot saved under the same name instead of making a twin', () => {
        const first = toSavedBot(member, 1);
        const list = upsertSavedBot([toSavedBot({ ...member, name: 'Other' }, 0)], first);
        const again = upsertSavedBot(list, toSavedBot({ ...member, name: 'researcher', systemPrompt: 'v2' }, 2));
        expect(again).toHaveLength(2);
        expect(again[0]).toMatchObject({ id: first.id, systemPrompt: 'v2' });
    });

    it('stays within its cap', () => {
        let list = [] as ReturnType<typeof toSavedBot>[];
        for (let i = 0; i < MAX_SAVED_BOTS + 5; i++) list = upsertSavedBot(list, toSavedBot({ ...member, name: `Bot${i}` }));
        expect(list).toHaveLength(MAX_SAVED_BOTS);
        expect(list[0].name).toBe(`Bot${MAX_SAVED_BOTS + 4}`);
    });
});
