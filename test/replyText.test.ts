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
