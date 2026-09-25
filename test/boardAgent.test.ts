import { describe, it, expect, vi } from 'vitest';

// These modules reach Firestore at import time.
vi.mock('../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../services/boards', () => ({ sendMessage: vi.fn(), isBot: () => true, getMessagesSince: vi.fn() }));
vi.mock('../services/spend', () => ({ recordSpend: vi.fn(async () => { }) }));
vi.mock('../services/agentMemory', () => ({ loadTurnMemory: vi.fn(), addNote: vi.fn(), recallNotes: vi.fn() }));

const { replyOrNotice, isFatalProviderError, describeHttpError, buildSystemPrompt, toolServersOf } = await import('../services/boardAgent');
const { migrateProviderSettings, extractJson, baseUrlOf, LEGACY_BASE_URLS } = await import('../services/llm');

const bot = { id: 'b1', name: 'Analyst', type: 'bot' as const, role: 'member' as const, addedAt: 0, systemPrompt: 'You analyse.' };

describe('replyOrNotice', () => {
    it('passes a real reply through, trimmed', () => {
        expect(replyOrNotice('  hello ')).toBe('hello');
    });

    it('turns an empty answer into a visible notice instead of a blank message', () => {
        expect(replyOrNotice('')).toMatch(/пустой ответ/);
        expect(replyOrNotice(null)).toMatch(/пустой ответ/);
    });
});

describe('isFatalProviderError', () => {
    it('stops on key, balance and model errors', () => {
        expect(isFatalProviderError(new Error('HTTP 401: bad key'))).toBe(true);
        expect(isFatalProviderError('HTTP 404')).toBe(true);
    });

    it('carries on after a rate limit or a network hiccup', () => {
        expect(isFatalProviderError(new Error('HTTP 429: slow down'))).toBe(false);
        expect(isFatalProviderError(new Error('HTTP 4010'))).toBe(false);
        expect(isFatalProviderError(new Error('Failed to fetch'))).toBe(false);
    });
});

describe('describeHttpError', () => {
    it('adds a hint and the provider message', async () => {
        const response = new Response(JSON.stringify({ error: { message: 'No credits' } }), { status: 402 });
        expect(await describeHttpError(response)).toBe('HTTP 402: на ключе закончился баланс: No credits');
    });

    it('copes with a body that is not JSON', async () => {
        expect(await describeHttpError(new Response('oops', { status: 500 }))).toBe('HTTP 500');
    });
});

describe('buildSystemPrompt', () => {
    it('puts the persona and memory before the task, so the prefix can be cached', () => {
        const prompt = buildSystemPrompt(bot, 'general', 'MEMORY HERE', {
            assignment: { goal: 'G', instruction: 'Do X', step: 1, totalSteps: 2 }
        });
        expect(prompt.indexOf('You analyse.')).toBeLessThan(prompt.indexOf('MEMORY HERE'));
        expect(prompt.indexOf('MEMORY HERE')).toBeLessThan(prompt.indexOf('YOUR ASSIGNMENT: Do X'));
    });

    it('marks the final turn of a discussion', () => {
        const prompt = buildSystemPrompt(bot, 'general', '', { discussion: { participants: ['Analyst'], task: 'T', turn: 2, totalTurns: 2 } });
        expect(prompt).toContain('FINAL turn');
    });
});

describe('toolServersOf', () => {
    it('merges the legacy field and the list without duplicates', () => {
        expect(toolServersOf({ ...bot, toolServerUrl: 'https://a/mcp', toolServerUrls: ['https://b/mcp', 'https://a/mcp', ' '] }))
            .toEqual(['https://a/mcp', 'https://b/mcp']);
        expect(toolServersOf(bot)).toEqual([]);
    });
});

describe('migrateProviderSettings', () => {
    const base = { openRouterKey: '', openRouterModel: '', language: 'ru', userType: 'agent', following: [] } as any;

    it('moves a Groq key onto the single API with Groq\'s address', () => {
        const next: any = migrateProviderSettings({ ...base, aiProvider: 'groq', groqKey: 'gsk_1', groqModel: 'llama' });
        expect(next.openRouterKey).toBe('gsk_1');
        expect(next.apiBaseUrl).toBe(LEGACY_BASE_URLS.groq);
        expect(next.openRouterModel).toBe('llama');
        expect(next.groqKey).toBeUndefined();
        expect(next.aiProvider).toBe('openrouter');
    });

    it('moves a Gemini key too', () => {
        const next: any = migrateProviderSettings({ ...base, aiProvider: 'gemini', geminiKey: 'AIza' });
        expect(next.openRouterKey).toBe('AIza');
        expect(next.apiBaseUrl).toBe(LEGACY_BASE_URLS.gemini);
    });

    it('leaves a configured OpenRouter key alone', () => {
        const next: any = migrateProviderSettings({ ...base, openRouterKey: 'sk-or', aiProvider: 'groq', groqKey: 'gsk' });
        expect(next.openRouterKey).toBe('sk-or');
        expect(baseUrlOf(next)).toBe('https://openrouter.ai/api/v1');
    });
});

describe('extractJson', () => {
    it('finds JSON in prose and fences, and returns null otherwise', () => {
        expect(extractJson('Here: {"a":1} ok')).toEqual({ a: 1 });
        expect(extractJson('```json\n{"b":2}\n```')).toEqual({ b: 2 });
        expect(extractJson('no json')).toBeNull();
        expect(extractJson('{broken')).toBeNull();
    });
});
