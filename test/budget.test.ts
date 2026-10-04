import { describe, it, expect, vi, afterEach } from 'vitest';
import { withBudget, limitOf, DEFAULT_SUBREQUEST_LIMIT } from '../worker/src/budget';

afterEach(() => vi.unstubAllGlobals());

describe('the subrequest budget of a server run', () => {
    it('counts the requests of its own run only', async () => {
        const real = globalThis.fetch;
        globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
        try {
            const [a, b] = await Promise.all([
                withBudget(50, async budget => { await fetch('https://x'); await fetch('https://y'); return budget.left(); }),
                withBudget(50, async budget => { await fetch('https://z'); return budget.left(); })
            ]);
            expect(a).toBe(48);
            expect(b).toBe(49);
            await fetch('https://outside'); // not in a run: counted nowhere
        } finally {
            globalThis.fetch = real;
        }
    });

    it('takes its limit from the environment, 50 by default', () => {
        expect(limitOf({})).toBe(DEFAULT_SUBREQUEST_LIMIT);
        expect(limitOf({ SUBREQUEST_LIMIT: '10000' })).toBe(10000);
        expect(limitOf({ SUBREQUEST_LIMIT: 'nonsense' })).toBe(50);
    });
});
