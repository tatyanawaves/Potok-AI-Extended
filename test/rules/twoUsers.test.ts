/**
 * Two people, one board, real security rules: Alice owns the board and set up
 * its bot; Bob, a member, calls that bot. The bot runs on Bob's accounts, so
 * every tool call must wait for Bob's yes and say whose bot it is; with no
 * one to ask it gets no tools; and the reply it posts, written from Bob's
 * session, has to pass the rules as the bot with postedBy = Bob.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import { FirestoreRest, restAgentStore } from '../../worker/src/firestoreRest';
import { runAndPostTurn, resetToolConnections } from '../../services/runtime/turn';
import { setMcpFetch } from '../../services/mcp';
import { botIdsOf } from '../../services/mentions';
import type { BoardMember } from '../../types';

const PROJECT = 'demo-two-users';
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const BOT = '7f0c2d1e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const TOOLS = 'https://box.test/mcp';

let env: RulesTestEnvironment;
const realFetch = globalThis.fetch;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: { rules: readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: HOST, port: Number(PORT) }
    });
});
afterAll(async () => { await env?.cleanup(); });

const members: BoardMember[] = [
    { id: 'alice', name: 'Alice', type: 'human', role: 'owner', addedAt: 1 },
    { id: 'bob', name: 'Bob', type: 'human', role: 'member', addedAt: 2 },
    { id: BOT, name: 'Helper', type: 'bot', role: 'member', addedAt: 3, ownerId: 'alice', toolServerUrls: [TOOLS], systemPrompt: 'You help.' }
];

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'boards/b1'), { name: 'Team', ownerId: 'alice', members, memberIds: members.map(m => m.id), botIds: botIdsOf(members), createdAt: 1 });
        await setDoc(doc(db, 'boards/b1/channels/c1'), { boardId: 'b1', name: 'general', createdAt: 1 });
        await setDoc(doc(db, 'boards/b1/channels/c1/messages/m1'), {
            boardId: 'b1', channelId: 'c1', authorId: 'bob', postedBy: 'bob', authorName: 'Bob', authorType: 'human',
            content: '@Helper покажи файлы', mentions: ['Helper'], timestamp: Date.now() - 1000
        });
    });
});

afterEach(() => {
    globalThis.fetch = realFetch;
    resetToolConnections();
    setMcpFetch((url, init) => fetch(url, init));
});

/** An unsigned token, which the emulator accepts in place of a real one. */
const tokenFor = (uid: string) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
        iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: now, exp: now + 3600, auth_time: now,
        sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} }
    })}.`;
};

const storeFor = (uid: string) => restAgentStore(
    new FirestoreRest({ projectId: PROJECT, apiKey: 'unused', firestoreEmulatorHost: `${HOST}:${PORT}` }, { get: async () => tokenFor(uid) } as any),
    { toolToken: async () => undefined, scope: uid }
);

/** The model asks for a shell command once, then answers; Firestore traffic goes through. */
const fakeModel = () => {
    let calls = 0;
    globalThis.fetch = (async (url: any, init?: any) => {
        if (!String(url).includes('/chat/completions')) return realFetch(url, init);
        calls++;
        const message = calls === 1
            ? { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'sandbox_shell', arguments: '{"command":"ls"}' } }] }
            : { content: 'Готово' };
        return Response.json({ choices: [{ message }], usage: { total_tokens: 1 } });
    }) as any;
};

/** A tool server that records what it was asked. */
const fakeTools = () => {
    const ran: string[] = [];
    setMcpFetch(async (_url, init) => {
        const body = JSON.parse(String(init.body));
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
        if (body.id === undefined) return new Response(null, { status: 202 });
        if (body.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'sandbox_shell', inputSchema: { type: 'object' } }] } });
        ran.push(body.params.name);
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'exit 0\nfile.txt' }] } });
    });
    return ran;
};

const settings = { openRouterKey: 'k', openRouterModel: 'm', dailyRequestLimit: 0 } as any;
const turn = (uid: string, approveTool?: any) => runAndPostTurn({
    store: storeFor(uid), agent: members[2], boardId: 'b1', channelId: 'c1', channelName: 'general', settings, approveTool
});

const posted = async () => {
    let rows: any[] = [];
    await env.withSecurityRulesDisabled(async context => {
        rows = (await getDocs(collection(context.firestore(), 'boards/b1/channels/c1/messages'))).docs.map(d => d.data());
    });
    return rows.filter(r => r.authorId === BOT);
};

describe("Bob calls Alice's bot", () => {
    it('asks Bob before the tool runs, saying the bot is not his, and posts the reply as the bot via Bob', async () => {
        fakeModel();
        const ran = fakeTools();
        const asked: any[] = [];
        const outcome = await turn('bob', async (...args: any[]) => { asked.push(args); return true; });

        expect(outcome.ok).toBe(true);
        expect(asked).toHaveLength(1);
        expect(asked[0][1]).toBe('sandbox_shell');
        expect(asked[0][3]).toBe('foreign');
        expect(ran).toEqual(['sandbox_shell']);

        const [reply] = await posted();
        expect(reply.content).toBe('Готово');
        expect(reply.postedBy).toBe('bob');
    });

    it('does not run the tool when Bob says no', async () => {
        fakeModel();
        const ran = fakeTools();
        await turn('bob', async () => false);
        expect(ran).toEqual([]);
    });

    it('gets no tools at all when no one can approve, as on the server', async () => {
        fakeModel();
        const ran = fakeTools();
        const outcome = await turn('bob');
        expect(outcome.ok).toBe(true);
        expect(ran).toEqual([]);
    });

    it("runs Alice's own bot for Alice without asking", async () => {
        fakeModel();
        const ran = fakeTools();
        const approve = vi.fn(async () => true);
        await turn('alice', approve);
        expect(approve).not.toHaveBeenCalled();
        expect(ran).toEqual(['sandbox_shell']);
        const [reply] = await posted();
        expect(reply.postedBy).toBe('alice');
    });
});
