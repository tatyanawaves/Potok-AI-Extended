import { describe, it, expect, vi, afterEach } from 'vitest';
import { complete, isFatalProviderError, DEFAULT_MODEL } from '../services/llm';

const json = (status: number, body: any, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const ok = (model: string) => json(200, { model, choices: [{ message: { content: 'hi' } }] });

const settings: any = { openRouterKey: 'k', openRouterModel: 'gone/model:free' };
const request = { messages: [{ role: 'user' as const, content: 'x' }] };

/** Routes fetch by URL and by the model in the body; records the models asked for. */
const mockFetch = (answer: (model: string) => Response) => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/models')) {
            return json(200, { data: [
                { id: DEFAULT_MODEL, context_length: 128000, supported_parameters: ['tools'] },
                { id: 'other/model:free', context_length: 128000, supported_parameters: ['tools'] }
            ] });
        }
        const model = JSON.parse(String(init?.body)).model;
        asked.push(model);
        return answer(model);
    }));
    return asked;
};

afterEach(() => vi.unstubAllGlobals());

describe('complete: failures and fallbacks', () => {
    it('moves on to a live free model when the chosen one no longer exists', async () => {
        const asked = mockFetch(m => m === 'gone/model:free'
            ? json(404, { error: { message: 'No endpoints found for gone/model:free.' } })
            : ok(m));
        const result = await complete(request, settings);
        expect(result.model).toBe(DEFAULT_MODEL);
        expect(asked).toEqual(['gone/model:free', DEFAULT_MODEL]);
    });

    it('retries a busy model and then switches instead of failing', async () => {
        const asked = mockFetch(m => m === 'gone/model:free'
            ? json(429, { error: { message: 'temporarily rate-limited upstream' } }, { 'retry-after': '0.01' })
            : ok(m));
        const result = await complete(request, settings);
        expect(result.content).toBe('hi');
        expect(asked.filter(m => m === 'gone/model:free')).toHaveLength(3);
    });

    it('survives a dropped connection instead of failing the step', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            if (++calls === 1) throw new TypeError('Failed to fetch');
            return ok('gone/model:free');
        }));
        const result = await complete(request, settings);
        vi.useRealTimers();
        expect(result.content).toBe('hi');
        expect(calls).toBe(2);
    });

    it('does not retry after the user stops', async () => {
        const controller = new AbortController();
        controller.abort();
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls++;
            throw new DOMException('aborted', 'AbortError');
        }));
        await expect(complete({ ...request, signal: controller.signal }, settings)).rejects.toThrow();
        expect(calls).toBe(1);
    });

    it('stops at once on the daily free quota, with a reason a person can act on', async () => {
        const asked = mockFetch(() => json(429, { error: { message: 'Rate limit exceeded: free-models-per-day.' } }));
        const error = await complete(request, settings).catch(e => e);
        expect(asked).toHaveLength(1);
        expect(error.message).toMatch(/дневной лимит/);
        expect(isFatalProviderError(error)).toBe(true);
    });

    it('explains the privacy setting that blocks free models', async () => {
        mockFetch(() => json(404, { error: { message: 'No endpoints found matching your data policy' } }));
        const error = await complete(request, settings).catch(e => e);
        expect(error.message).toMatch(/приватности/);
    });

    it('does not swap a paid model for a free one just because it is busy', async () => {
        const asked = mockFetch(() => json(429, { error: { message: 'slow down' } }, { 'retry-after': '0.01' }));
        await complete(request, { ...settings, openRouterModel: 'paid/model' }).catch(() => { });
        expect(new Set(asked)).toEqual(new Set(['paid/model']));
    });
});

const sse = (chunks: any[]) => new Response(new ReadableStream({
    start(controller) {
        const encoder = new TextEncoder();
        for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
    }
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

describe('complete: streaming', () => {
    it('reports the text as it arrives and returns the whole answer', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sse([
            { model: 'm', choices: [{ delta: { content: 'При' } }] },
            { choices: [{ delta: { content: 'вет' } }] },
            { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }
        ])));
        const seen: string[] = [];
        const result = await complete({ ...request, onDelta: t => seen.push(t) }, { ...settings, openRouterModel: 'm' });
        expect(seen).toEqual(['При', 'Привет']);
        expect(result.content).toBe('Привет');
        expect(result.usage.totalTokens).toBe(5);
    });

    it('joins tool call fragments by index', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sse([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'sandbox_', arguments: '{"comm' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'shell', arguments: 'and":"ls"}' } }] } }] }
        ])));
        const result = await complete({ ...request, onDelta: () => { } }, { ...settings, openRouterModel: 'm' });
        expect(result.toolCalls).toEqual([{ id: 'c1', name: 'sandbox_shell', args: '{"command":"ls"}' }]);
    });
});

describe('complete: the person\'s fallback model', () => {
    it('takes over from a busy paid model', async () => {
        const asked = mockFetch(m => m === 'paid/model' ? json(503, { error: { message: 'overloaded' } }) : ok(m));
        const result = await complete(request, { ...settings, openRouterModel: 'paid/model', fallbackModel: 'backup/model' });
        expect(result.model).toBe('backup/model');
        expect(asked.at(-1)).toBe('backup/model');
    }, 15_000);
});

describe('complete: a stream that stalls', () => {
    it('gives up after the silence timeout even when the body ignores the abort', async () => {
        vi.useFakeTimers();
        try {
            // One chunk, then nothing, ever; and the body never notices aborts.
            vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Нач"}}]}\n\n'));
                }
            }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));
            const pending = complete({ ...request, onDelta: () => { } }, { ...settings, openRouterModel: 'paid/model' });
            const outcome = pending.then(() => 'answered', (e: Error) => e.message);
            await vi.advanceTimersByTimeAsync(46_000);
            expect(await outcome).toMatch(/HTTP 504.*не ответила/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops at the attempt limit even when keep-alives keep arriving', async () => {
        vi.useFakeTimers();
        try {
            vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
                start(controller) {
                    const keepAlive = () => { try { controller.enqueue(new TextEncoder().encode(': OPENROUTER PROCESSING\n\n')); } catch { return; } setTimeout(keepAlive, 10_000); };
                    keepAlive();
                }
            }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));
            const outcome = complete({ ...request, onDelta: () => { } }, { ...settings, openRouterModel: 'paid/model' })
                .then(() => 'answered', (e: Error) => e.message);
            await vi.advanceTimersByTimeAsync(151_000);
            expect(await outcome).toMatch(/HTTP 504/);
        } finally {
            vi.useRealTimers();
        }
    });
});
