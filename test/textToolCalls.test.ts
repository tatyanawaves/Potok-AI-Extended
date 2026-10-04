import { describe, it, expect } from 'vitest';
import { textToolCalls } from '../services/textToolCalls';

const offered = new Set(['sandbox_write_file', 'sandbox_run_code']);

describe('tool calls written as text', () => {
    it('takes the XML form a Nemotron/Qwen model printed', () => {
        const content = [
            '<tool_call>', '<function=sandbox_write_file>', '<parameter=path>', '/root/check/sales.csv', '</parameter>',
            '<parameter=content>', 'January,1000', 'May,900', '</parameter>', '</function>', '</tool_call>'
        ].join('\n');
        const { calls, rest } = textToolCalls(content, offered);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('sandbox_write_file');
        expect(JSON.parse(calls[0].args)).toEqual({ path: '/root/check/sales.csv', content: 'January,1000\nMay,900' });
        expect(rest).toBeNull();
    });

    it('takes the JSON form and keeps the words around it', () => {
        const { calls, rest } = textToolCalls('Считаю.\n<tool_call>{"name": "sandbox_run_code", "arguments": {"code": "print(2)", "n": 3}}</tool_call>', offered);
        expect(JSON.parse(calls[0].args)).toEqual({ code: 'print(2)', n: 3 });
        expect(rest).toBe('Считаю.');
    });

    it('leaves alone calls to tools that were not offered, and plain text', () => {
        const foreign = '<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>';
        expect(textToolCalls(foreign, offered)).toEqual({ calls: [], rest: foreign });
        expect(textToolCalls('просто ответ', offered)).toEqual({ calls: [], rest: 'просто ответ' });
        expect(textToolCalls(null, offered)).toEqual({ calls: [], rest: null });
    });

    it('reads numbers and lists as values, other text as text', () => {
        const { calls } = textToolCalls('<tool_call><function=sandbox_run_code><parameter=timeout>30</parameter><parameter=code>x = [1, 2]</parameter></function></tool_call>', offered);
        expect(JSON.parse(calls[0].args)).toEqual({ timeout: 30, code: 'x = [1, 2]' });
    });
});

describe('markup left in a final reply', () => {
    it('is found whatever tool it names', () => {
        const { calls, rest } = textToolCalls('Почти готово.\n<tool_call>{"name": "anything", "arguments": {}}</tool_call>', { has: () => true });
        expect(calls).toHaveLength(1);
        expect(rest).toBe('Почти готово.');
    });
});
