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

describe('tool requests and drafts from the server', () => {
    const as = (uid: string) => env.authenticatedContext(uid).firestore();

    it('lets only the person asked see and answer a tool request, and only its status', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { getDoc, updateDoc } = await import('firebase/firestore');
        const request = { requestedBy: 'bob', bot: 'Helper', tool: 'sandbox_shell', args: '{}', status: 'pending', createdAt: 1 };

        await assertFails(setDoc(doc(as('alice'), 'boards/b1/approvals/a0'), request));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/approvals/a0'), { ...request, status: 'allowed' }));
        await assertSucceeds(setDoc(doc(as('bob'), 'boards/b1/approvals/a1'), request));

        await assertFails(getDoc(doc(as('alice'), 'boards/b1/approvals/a1')));
        await assertSucceeds(getDoc(doc(as('bob'), 'boards/b1/approvals/a1')));

        await assertFails(updateDoc(doc(as('alice'), 'boards/b1/approvals/a1'), { status: 'allowed' }));
        await assertFails(updateDoc(doc(as('bob'), 'boards/b1/approvals/a1'), { tool: 'delete_everything' }));
        await assertFails(updateDoc(doc(as('bob'), 'boards/b1/approvals/a1'), { status: 'maybe' }));
        await assertSucceeds(updateDoc(doc(as('bob'), 'boards/b1/approvals/a1'), { status: 'allowed' }));
    });

    it('takes drafts only for the board\'s bots, signed by the writer', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { getDoc } = await import('firebase/firestore');
        const draft = (postedBy: string) => ({ botName: 'Helper', text: 'Пишу…', postedBy, updatedAt: 1 });

        await assertSucceeds(setDoc(doc(as('bob'), `boards/b1/channels/c1/drafts/${BOT}`), draft('bob')));
        await assertFails(setDoc(doc(as('bob'), `boards/b1/channels/c1/drafts/${BOT}`), draft('alice')));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/channels/c1/drafts/alice'), draft('bob')));
        await assertFails(setDoc(doc(as('stranger'), `boards/b1/channels/c1/drafts/${BOT}`), draft('stranger')));
        await assertSucceeds(getDoc(doc(as('alice'), `boards/b1/channels/c1/drafts/${BOT}`)));
        await assertFails(getDoc(doc(as('stranger'), `boards/b1/channels/c1/drafts/${BOT}`)));
    });
});

describe('mention notices', () => {
    const as = (uid: string) => env.authenticatedContext(uid).firestore();
    const notice = (from: string, boardId = 'b1') => ({ from, fromName: 'X', boardId, boardName: 'Team', channelId: 'c1', channelName: 'general', text: '@Bob глянь', createdAt: 1, read: false });

    it('lets a member notify another member of the same board, in their own name only', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { addDoc, collection } = await import('firebase/firestore');
        await assertSucceeds(addDoc(collection(as('alice'), 'users/bob/notifications'), notice('alice')));
        await assertFails(addDoc(collection(as('alice'), 'users/bob/notifications'), notice('bob')));
        await assertFails(addDoc(collection(as('alice'), 'users/stranger/notifications'), notice('alice')));
        await assertFails(addDoc(collection(as('stranger'), 'users/bob/notifications'), notice('stranger')));
        await assertFails(addDoc(collection(as('alice'), 'users/bob/notifications'), { ...notice('alice'), read: true }));
    });

    it('lets only the person read their notices and only mark them read', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { getDoc, updateDoc } = await import('firebase/firestore');
        await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'users/bob/notifications/n1'), notice('alice')); });
        await assertFails(getDoc(doc(as('alice'), 'users/bob/notifications/n1')));
        await assertSucceeds(getDoc(doc(as('bob'), 'users/bob/notifications/n1')));
        await assertFails(updateDoc(doc(as('bob'), 'users/bob/notifications/n1'), { text: 'changed' }));
        await assertSucceeds(updateDoc(doc(as('bob'), 'users/bob/notifications/n1'), { read: true }));
    });
});

describe('schedules', () => {
    const as = (uid: string) => env.authenticatedContext(uid).firestore();
    const schedule = (createdBy: string, extra: Record<string, unknown> = {}) => ({
        bot: 'Helper', text: 'сводка новостей', time: '09:00', days: [1, 2, 3, 4, 5], tz: 'Asia/Almaty',
        channelId: 'c1', channelName: 'general', createdBy, createdByName: 'X', enabled: true, createdAt: 1, ...extra
    });

    it('lets a member schedule in their own name, with a sane time', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        await assertSucceeds(setDoc(doc(as('bob'), 'boards/b1/schedules/s1'), schedule('bob')));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/schedules/s2'), schedule('alice')));
        await assertFails(setDoc(doc(as('stranger'), 'boards/b1/schedules/s3'), schedule('stranger')));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/schedules/s4'), schedule('bob', { time: '25:00' })));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/schedules/s5'), schedule('bob', { text: '' })));
    });

    it('lets only the creator change it, and the creator or the owner remove it', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { getDoc, updateDoc, deleteDoc } = await import('firebase/firestore');
        await env.withSecurityRulesDisabled(async c => {
            await setDoc(doc(c.firestore(), 'boards/b1/schedules/s1'), schedule('bob'));
            await setDoc(doc(c.firestore(), 'boards/b1/schedules/s2'), schedule('bob'));
        });
        await assertSucceeds(getDoc(doc(as('alice'), 'boards/b1/schedules/s1')));
        await assertFails(getDoc(doc(as('stranger'), 'boards/b1/schedules/s1')));
        await assertFails(updateDoc(doc(as('alice'), 'boards/b1/schedules/s1'), { text: 'чужое' }));
        await assertSucceeds(updateDoc(doc(as('bob'), 'boards/b1/schedules/s1'), { enabled: false }));
        await assertFails(updateDoc(doc(as('bob'), 'boards/b1/schedules/s1'), { createdBy: 'alice' }));
        await assertSucceeds(deleteDoc(doc(as('alice'), 'boards/b1/schedules/s1')));
        await assertSucceeds(deleteDoc(doc(as('bob'), 'boards/b1/schedules/s2')));
    });
});

describe('knowledge base', () => {
    const as = (uid: string) => env.authenticatedContext(uid).firestore();
    const passage = (addedBy: string, extra: Record<string, unknown> = {}) => ({
        docId: 'd1', title: 'Регламент', index: 1, text: 'Отпуск — 28 дней.', author: 'Регламент', addedBy, createdAt: 1, ...extra
    });

    it('lets members add documents in their own name, within size', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        await assertSucceeds(setDoc(doc(as('bob'), 'boards/b1/knowledge/d1'), { title: 'Регламент', chunks: 1, chars: 17, addedBy: 'bob', addedByName: 'Bob', createdAt: 1 }));
        await assertSucceeds(setDoc(doc(as('bob'), 'boards/b1/kbChunks/d1-1'), passage('bob')));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/kbChunks/d1-2'), passage('alice')));
        await assertFails(setDoc(doc(as('stranger'), 'boards/b1/kbChunks/d1-3'), passage('stranger')));
        await assertFails(setDoc(doc(as('bob'), 'boards/b1/kbChunks/d1-4'), passage('bob', { text: 'x'.repeat(4001) })));
    });

    it('lets any member fill in a vector but change nothing else; uploader or owner removes', async () => {
        const { assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
        const { getDoc, updateDoc, deleteDoc } = await import('firebase/firestore');
        await env.withSecurityRulesDisabled(async c => {
            await setDoc(doc(c.firestore(), 'boards/b1/kbChunks/d1-1'), passage('bob'));
            await setDoc(doc(c.firestore(), 'boards/b1/kbChunks/d1-2'), passage('bob'));
        });
        await assertSucceeds(getDoc(doc(as('alice'), 'boards/b1/kbChunks/d1-1')));
        await assertFails(getDoc(doc(as('stranger'), 'boards/b1/kbChunks/d1-1')));
        await assertSucceeds(updateDoc(doc(as('alice'), 'boards/b1/kbChunks/d1-1'), { embedding: 'AAAA', embeddingModel: 'm' }));
        await assertFails(updateDoc(doc(as('alice'), 'boards/b1/kbChunks/d1-1'), { text: 'Отпуск — 90 дней.' }));
        await assertSucceeds(deleteDoc(doc(as('alice'), 'boards/b1/kbChunks/d1-1')));
        await assertSucceeds(deleteDoc(doc(as('bob'), 'boards/b1/kbChunks/d1-2')));
    });
});
