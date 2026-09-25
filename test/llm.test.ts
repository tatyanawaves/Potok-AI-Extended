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
