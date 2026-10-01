import { describe, it, expect, vi, afterEach } from 'vitest';
import { dailyLimitOf, overLimit, addToDay, limitMessage, DEFAULT_DAILY_REQUESTS } from '../services/spendLimit';
import { complete, isFatalProviderError } from '../services/llm';

afterEach(() => vi.unstubAllGlobals());

describe('the daily ceiling', () => {
    it('defaults to a ceiling, and 0 lifts it', () => {
        expect(dailyLimitOf({})).toBe(DEFAULT_DAILY_REQUESTS);
        expect(overLimit(5, 0)).toBe(false);
        expect(overLimit(300, 300)).toBe(true);
        expect(overLimit(299, 300)).toBe(false);
    });

    it('adds to today without touching other days', () => {
        expect(addToDay({ '2026-09-30': { requests: 9, tokens: 90 } }, '2026-10-01', 7))
            .toEqual({ '2026-09-30': { requests: 9, tokens: 90 }, '2026-10-01': { requests: 1, tokens: 7 } });
    });

    it('stops a task: the message counts as fatal', () => {
        expect(isFatalProviderError(new Error(limitMessage(300)))).toBe(true);
    });

    it('refuses a request before it is sent, through per-run hooks', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const usageHooks = { gate: async () => { throw new Error(limitMessage(1)); }, record: async () => { } };
        await expect(complete({ messages: [{ role: 'user', content: 'x' }] }, { openRouterKey: 'k', usageHooks } as any))
            .rejects.toThrow(/Дневной лимит запросов Potok/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('records the tokens of an answer through the hooks', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 42 } })));
        const record = vi.fn(async () => { });
        await complete({ messages: [{ role: 'user', content: 'x' }] }, { openRouterKey: 'k', openRouterModel: 'm', usageHooks: { gate: async () => { }, record } } as any);
        expect(record).toHaveBeenCalledWith(42);
    });
});
