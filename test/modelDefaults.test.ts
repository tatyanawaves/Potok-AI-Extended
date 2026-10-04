import { describe, it, expect, vi, afterEach } from 'vitest';
import { chooseHelperModels, FALLBACK_PREFERENCES, SERVICE_PREFERENCES } from '../services/modelDefaults';
import type { FreeModel } from '../services/llm';

const model = (id: string, tools = true, json = true): FreeModel => ({ id, name: id, tools, vision: false, json, contextLength: 262144 });

afterEach(() => vi.unstubAllGlobals());

describe('the fallback and service models a new account gets', () => {
    it('takes the preferred ones when they are listed', () => {
        const free = [model('nvidia/nemotron-3.5-lightning:free', true, false), model('google/gemma-4-31b-it:free'), model('google/gemma-4-26b-a4b-it:free')];
        expect(chooseHelperModels(free, 'nvidia/nemotron-3.5-lightning:free'))
            .toEqual({ fallback: 'google/gemma-4-31b-it:free', service: 'google/gemma-4-26b-a4b-it:free' });
    });

    it('falls back to another provider than the main model when the preferred are gone', () => {
        const free = [model('nvidia/a:free'), model('nvidia/b:free'), model('mistral/c:free', true, false), model('meta/d:free', false, true)];
        const chosen = chooseHelperModels(free, 'nvidia/a:free');
        expect(chosen.fallback).toBe('mistral/c:free');
        expect(chosen.service).toBe('nvidia/b:free');
    });

    it('never picks the main model itself', () => {
        const free = [model('google/gemma-4-31b-it:free'), model('x/y:free')];
        expect(chooseHelperModels(free, 'google/gemma-4-31b-it:free').fallback).toBe('x/y:free');
    });

    it('keeps the first choices when the list cannot be read', () => {
        expect(chooseHelperModels([], 'any')).toEqual({ fallback: FALLBACK_PREFERENCES[0], service: SERVICE_PREFERENCES[0] });
    });
});

describe('filling them in', () => {
    it('fills only empty fields, once, and only for OpenRouter', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })));
        const { withHelperDefaults } = await import('../services/modelDefaults');
        const filled = await withHelperDefaults({ openRouterModel: '', fallbackModel: 'my/own:free' } as any);
        expect(filled).toMatchObject({ fallbackModel: 'my/own:free', memoryModel: SERVICE_PREFERENCES[0], modelDefaultsSet: true });
        const cleared = { ...filled, memoryModel: '' };
        expect(await withHelperDefaults(cleared)).toBe(cleared);
        const groq = await withHelperDefaults({ apiBaseUrl: 'https://api.groq.com/openai/v1' } as any);
        expect(groq).toEqual({ apiBaseUrl: 'https://api.groq.com/openai/v1', modelDefaultsSet: true });
    });
});
