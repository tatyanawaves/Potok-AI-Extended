import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentStore } from '../services/runtime/store';
import { runOrchestration, TaskContext } from '../services/runtime/orchestrate';
import { findNotes, fileNote } from '../services/runtime/memory';
import {
    parsePlan, readySteps, appendStep, inputsFor, RosterEntry
} from '../services/orchestratorCore';
import { packVector, unpackVector, cosine, rankHybrid, EMPTY_SUMMARY, MemoryNote } from '../services/memoryCore';
import { BoardMember, BoardMessage } from '../types';

const roster: RosterEntry[] = [
    { name: 'A', persona: '', tools: [] },
    { name: 'B', persona: '', tools: [] },
    { name: 'C', persona: '', tools: [] }
];

describe('plan dependencies', () => {
    it('keeps declared dependencies and drops forward or unknown ones', () => {
        const plan = parsePlan(JSON.stringify({
            steps: [
                { bot: 'A', instruction: 'one', after: [] },
                { bot: 'B', instruction: 'two', after: [] },
                { bot: 'C', instruction: 'three', after: [1, 2, 5, 3] }
            ]
        }), 't', roster, 5);
        expect(plan.steps.map(s => s.after)).toEqual([[], [], [1, 2]]);
    });

    it('reads a step without "after" as following the previous one', () => {
        const plan = parsePlan(JSON.stringify({ steps: [{ bot: 'A', instruction: 'x' }, { bot: 'B', instruction: 'y' }] }), 't', roster, 5);
        expect(plan.steps.map(s => s.after)).toEqual([[], [1]]);
    });

    it('renumbers dependencies when a step is dropped', () => {
        const plan = parsePlan(JSON.stringify({
            steps: [
                { bot: 'Ghost', instruction: 'gone', after: [] },
                { bot: 'A', instruction: 'one', after: [] },
                { bot: 'B', instruction: 'two', after: [2] }
            ]
        }), 't', roster, 5);
        expect(plan.steps).toEqual([
            { id: 1, bot: 'A', instruction: 'one', after: [] },
            { id: 2, bot: 'B', instruction: 'two', after: [1] }
        ]);
    });

    it('forms waves of independent steps, capped in size', () => {
        const steps = [
            { id: 1, bot: 'A', instruction: '', after: [] },
            { id: 2, bot: 'B', instruction: '', after: [] },
            { id: 3, bot: 'C', instruction: '', after: [] },
            { id: 4, bot: 'A', instruction: '', after: [1, 2] }
        ];
        expect(readySteps(steps, new Set()).map(s => s.id)).toEqual([1, 2, 3]);
        expect(readySteps(steps, new Set(), 2).map(s => s.id)).toEqual([1, 2]);
        expect(readySteps(steps, new Set([1])).map(s => s.id)).toEqual([2, 3]);
        expect(readySteps(steps, new Set([1, 2, 3])).map(s => s.id)).toEqual([4]);
    });

    it('passes the results a step depends on, and appends supervisor steps after the done work', () => {
        const step = { id: 3, bot: 'C', instruction: '', after: [1, 2] };
        const log = [
            { stepId: 1, bot: 'A', instruction: '', result: 'r1', ok: true },
            { stepId: 2, bot: 'B', instruction: '', result: 'failed', ok: false }
        ];
        expect(inputsFor(step, log)).toEqual([{ bot: 'A', result: 'r1' }]);
        expect(appendStep([step], { bot: 'A', instruction: 'more' }, new Set([1, 3])).at(-1))
            .toEqual({ id: 4, bot: 'A', instruction: 'more', after: [1, 3] });
    });
});

describe('vectors', () => {
    it('round-trips through the packed form', () => {
        const v = [0.5, -0.25, 1, 0];
        expect(unpackVector(packVector(v))).toEqual(v);
    });

    it('measures similarity', () => {
        expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
        expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
        expect(cosine([1, 0], [1])).toBe(0);
    });

    it('finds a note by meaning when no word matches, and keeps keyword hits', () => {
        const note = (text: string, v?: number[]): MemoryNote =>
            ({ text, author: 'x', createdAt: 0, ...(v ? { embedding: packVector(v), embeddingModel: 'm' } : {}) });
        const budget = note('Рекламный бюджет — 50 тысяч', [1, 0, 0]);
        const standup = note('Созвон по пятницам', [0, 1, 0]);
        const invoice = note('Счёт INV-42 оплачен');   // no vector yet

        const byMeaning = rankHybrid('сколько тратим на маркетинг', [0.9, 0.1, 0], [budget, standup, invoice], 'm');
        expect(byMeaning).toEqual([budget]);

        const byWord = rankHybrid('счёт INV-42', [0, 0, 1], [budget, standup, invoice], 'm');
        expect(byWord[0]).toBe(invoice);
    });
});

// --- The runtime against an in-memory store and a stub model ----------------------

const memoryStore = () => {
    const messages: BoardMessage[] = [];
    const notes: MemoryNote[] = [];
    let summary = EMPTY_SUMMARY;
    let clock = 1000;
    const store: AgentStore = {
        getSummary: async () => summary,
        replaceSummary: async (_b, _c, expected, next) => {
            if (summary.coveredUntil !== expected) return false;
            summary = next;
            return true;
        },
        getMessagesSince: async (_b, _c, since, count) => messages.filter(m => m.timestamp > since).slice(-count),
        postMessage: async (m) => { messages.push({ ...m, id: String(messages.length), mentions: [], timestamp: clock++ } as BoardMessage); },
        loadNotes: async () => notes,
        addNote: async (_b, n) => { notes.push({ ...n, id: String(notes.length), createdAt: clock++ }); },
        setNoteEmbedding: async (_b, id, embedding, model) => {
            const n = notes.find(x => x.id === id)!;
            n.embedding = embedding;
            n.embeddingModel = model;
        },
        toolToken: async () => undefined
    };
    return { store, messages, notes };
};

const bot = (name: string): BoardMember => ({ id: name, name, type: 'bot', role: 'member', addedAt: 0, systemPrompt: `You are ${name}` });

const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('orchestrated run', () => {
    it('runs independent steps at the same time and dependent ones after', async () => {
        const { store, messages } = memoryStore();
        const running = new Set<string>();
        let maxConcurrent = 0;
        const order: string[] = [];

        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
            const body = JSON.parse(init.body);
            const system = body.messages[0].content as string;
            const prompt = body.messages.at(-1).content as string;

            if (prompt.startsWith('ORCHESTRATOR_PLAN')) {
                return reply(JSON.stringify({
                    goal: 'G', criteria: ['c'],
                    steps: [
                        { bot: 'A', instruction: 'gather one', after: [] },
                        { bot: 'B', instruction: 'gather two', after: [] },
                        { bot: 'C', instruction: 'combine', after: [1, 2] }
                    ]
                }));
            }
            if (prompt.startsWith('ORCHESTRATOR_EVAL')) return reply('{"progress": 50, "criteria_met": [false], "done": false, "next": null}');
            if (prompt.startsWith('ORCHESTRATOR_FINAL')) return reply('{"answer": "final", "progress": 100, "criteria": [{"met": true}]}');

            const name = system.match(/You are "([^"]+)"/)![1];
            running.add(name);
            maxConcurrent = Math.max(maxConcurrent, running.size);
            await new Promise(r => setTimeout(r, 20));
            running.delete(name);
            order.push(name);
            // The combining step must be handed both earlier results.
            const sawInputs = system.includes('RESULTS YOU BUILD ON') && system.includes('result of A') && system.includes('result of B');
            return reply(name === 'C' ? `combined:${sawInputs}` : `result of ${name}`);
        }));

        const ctx: TaskContext = {
            store, settings: { openRouterKey: 'k', openRouterModel: 'm' } as any,
            boardId: 'b', channelId: 'c', channelName: 'general',
            bots: [bot('A'), bot('B'), bot('C')], task: 'do it', maxSteps: 5,
            author: { id: 'u', name: 'U' }, toolPolicy: 'off'
        };
        const { state, report } = await runOrchestration(ctx);

        expect(maxConcurrent).toBe(2);
        expect(order.at(-1)).toBe('C');
        expect(state.log.find(l => l.bot === 'C')!.result).toBe('combined:true');
        expect(report.progress).toBe(100);
        expect(messages[0].content).toContain('🧭 План');
        expect(messages.at(-1)!.content).toContain('Степень выполнения: 100%');
    });
});

describe('semantic memory', () => {
    it('embeds notes on the way in and backfills old ones on recall', async () => {
        const { store, notes } = memoryStore();
        // A toy embedding: one dimension per keyword.
        const vec = (t: string) => [/бюджет|тратим|деньги/i.test(t) ? 1 : 0, /созвон|встреч/i.test(t) ? 1 : 0, 0.01];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
            const body = JSON.parse(init.body);
            expect(url).toMatch(/\/embeddings$/);
            return new Response(JSON.stringify({ data: body.input.map((t: string, index: number) => ({ index, embedding: vec(t) })) }), { status: 200 });
        }));

        const settings = { openRouterKey: 'k', embeddingModel: 'emb' } as any;
        await store.addNote('b', { text: 'Созвон по пятницам', author: 'x' });      // filed before semantic search
        await fileNote(store, settings, 'b', { text: 'Бюджет на рекламу 50 тысяч', author: 'x' });
        expect(notes[1].embeddingModel).toBe('emb');

        const found = await findNotes(store, settings, 'b', 'сколько денег тратим');
        expect(found.map(n => n.text)).toEqual(['Бюджет на рекламу 50 тысяч']);
        expect(notes[0].embeddingModel).toBe('emb');   // backfilled
    });

    it('falls back to keywords when the provider has no /embeddings', async () => {
        const { store } = memoryStore();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"no"}}', { status: 404 })));
        const settings = { openRouterKey: 'k', embeddingModel: 'emb-missing', apiBaseUrl: 'https://x/v1' } as any;
        await store.addNote('b', { text: 'Бюджет на рекламу 50 тысяч', author: 'x' });
        expect((await findNotes(store, settings, 'b', 'бюджет')).length).toBe(1);
    });
});
