import { describe, it, expect } from 'vitest';
import { parseRichText } from '../components/RichText';

describe('parseRichText', () => {
    it('keeps plain text as is', () => {
        expect(parseRichText('привет\nмир')).toEqual([{ kind: 'text', text: 'привет\nмир' }]);
    });

    it('finds bold and inline code', () => {
        expect(parseRichText('= **6765**, файл `a.py`')).toEqual([
            { kind: 'text', text: '= ' },
            { kind: 'bold', text: '6765' },
            { kind: 'text', text: ', файл ' },
            { kind: 'code', text: 'a.py' },
        ]);
    });

    it('turns fences into blocks without the fence lines', () => {
        expect(parseRichText('Вывод:\n\n```python\nprint(1)\n```\nГотово')).toEqual([
            { kind: 'text', text: 'Вывод:\n' },
            { kind: 'block', lang: 'python', text: 'print(1)' },
            { kind: 'text', text: 'Готово' },
        ]);
    });

    it('closes an unterminated fence at the end', () => {
        expect(parseRichText('```\nx = 1')).toEqual([{ kind: 'block', lang: '', text: 'x = 1' }]);
    });

    it('leaves markup inside a block alone', () => {
        expect(parseRichText('```\n**a** `b`\n```')).toEqual([{ kind: 'block', lang: '', text: '**a** `b`' }]);
    });

    it('leaves stray asterisks as text', () => {
        expect(parseRichText('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }]);
    });
});
