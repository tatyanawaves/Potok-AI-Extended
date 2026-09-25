import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listenWithRetry } from '../services/listen';

/** A fake subscribe that fails its first `failures` attempts with `code`. */
const flaky = (failures: number, code = 'permission-denied') => {
    const calls = { subscribed: 0, unsubscribed: 0 };
    const subscribe = (onError: (error: unknown) => void) => {
        calls.subscribed++;
        if (calls.subscribed <= failures) queueMicrotask(() => onError({ code }));
        return () => { calls.unsubscribed++; };
    };
    return { calls, subscribe };
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('listenWithRetry', () => {
    it('listens again after a refusal, as right after a board is created', async () => {
        const { calls, subscribe } = flaky(1);
        listenWithRetry(subscribe, 'test', { delayMs: 100 });

        await vi.advanceTimersByTimeAsync(99);
        expect(calls.subscribed).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls.subscribed).toBe(2);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('does not retry other errors, and says so', async () => {
        const { calls, subscribe } = flaky(1, 'unavailable');
        listenWithRetry(subscribe, 'test', { delayMs: 100 });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(calls.subscribed).toBe(1);
        expect(console.error).toHaveBeenCalledOnce();
    });

    it('gives up after its retries, waiting longer each time', async () => {
        const { calls, subscribe } = flaky(Infinity);
        listenWithRetry(subscribe, 'test', { retries: 3, delayMs: 100 });

        await vi.advanceTimersByTimeAsync(100 + 200 + 300);
        expect(calls.subscribed).toBe(4);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(calls.subscribed).toBe(4);
        expect(console.error).toHaveBeenCalledOnce();
    });

    it('stops a pending retry when unsubscribed', async () => {
        const { calls, subscribe } = flaky(1);
        const stop = listenWithRetry(subscribe, 'test', { delayMs: 100 });

        await vi.advanceTimersByTimeAsync(10);
        stop();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(calls.subscribed).toBe(1);
        expect(calls.unsubscribed).toBe(1);
    });
});
