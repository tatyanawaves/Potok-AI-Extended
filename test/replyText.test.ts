import { describe, it, expect } from 'vitest';
import { plainReply } from '../services/replyText';
import { markCacheable } from '../services/llm';

describe('a reply that came back as JSON', () => {
    it('reads as text: the summary, then the lists', () => {
        const json = '{"summary":"Step 1: Done. Step 2: Done.","facts":["Total 15000","Average 3000"]}';
        expect(plainReply(json)).toBe('Step 1: Done. Step 2: Done.\n\n- Total 15000\n- Average 3000');
    });

    it('takes a fenced block too', () => {
        expect(plainReply('```json\n{"answer": "работает"}\n```')).toBe('работает');
    });

    it('leaves text, broken JSON and data the person asked for alone', () => {
        expect(plainReply('Обычный ответ.')).toBe('Обычный ответ.');
        expect(plainReply('{"summary": "оборвано')).toBe('{"summary": "оборвано');
        expect(plainReply('{"id": 7, "price": 120}')).toBe('{"id": 7, "price": 120}');
        expect(plainReply('[1, 2]')).toBe('[1, 2]');
    });
});

describe('prompt caching', () => {
    it('marks the system prompt for Anthropic and Gemini models only', () => {
        const messages = [{ role: 'system' as const, content: 'rules' }, { role: 'user' as const, content: 'hi' }];
        expect((markCacheable(messages, 'anthropic/claude-sonnet')[0].content as any)[0]).toMatchObject({ text: 'rules', cache_control: { type: 'ephemeral' } });
        expect(markCacheable(messages, 'google/gemini-2.5-flash')[0].content).not.toBe('rules');
        expect(markCacheable(messages, 'nvidia/nemotron:free')).toBe(messages);
    });
});

describe('where a reply\'s tokens went', () => {
    it('keeps the thinking and cached parts and counts requests', async () => {
        const { usageFrom, addUsage, tokenDetailOf, EMPTY_USAGE } = await import('../services/usage');
        const one = usageFrom({ usage: { prompt_tokens: 2000, completion_tokens: 3000, total_tokens: 5000, completion_tokens_details: { reasoning_tokens: 2500 }, prompt_tokens_details: { cached_tokens: 1200 } } });
        const sum = addUsage(addUsage(EMPTY_USAGE, one), one);
        expect(tokenDetailOf(sum)).toEqual({ prompt: 4000, completion: 6000, reasoning: 5000, cached: 2400, requests: 2 });
    });
});

describe('messages shaped for the model', () => {
    it('folds the system prompt into the first request for Gemma, and leaves other models alone', async () => {
        const { foldSystemForGemma, shapeFor } = await import('../services/llm');
        const messages = [
            { role: 'system' as const, content: 'rules' },
            { role: 'assistant' as const, content: 'earlier' },
            { role: 'user' as const, content: 'task' }
        ];
        expect(foldSystemForGemma(messages, 'google/gemma-4-26b-a4b-it:free')).toEqual([
            { role: 'assistant', content: 'earlier' },
            { role: 'user', content: 'rules\n\ntask' }
        ]);
        expect(foldSystemForGemma(messages, 'nvidia/nemotron:free')).toBe(messages);
        // Gemma is not cached as Gemini is; Gemini keeps its system message, marked.
        expect(shapeFor(messages, 'google/gemma-4-31b-it:free', true)[0].role).toBe('assistant');
        expect((shapeFor(messages, 'google/gemini-2.5-flash', true)[0].content as any)[0].cache_control).toBeDefined();
    });
});
