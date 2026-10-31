import { describe, it, expect } from 'vitest';
import { contactHint } from '../services/contacts';
import { plainText } from '../components/RichText';

describe('people with the same name in the forward list', () => {
    const all = [
        { uid: 'BisYvQri5vUKP4a9akve0XRHfB62', name: 'Tatyana', role: 'Explorer' },
        { uid: 'gyiUFmOjVjOELKFQKbeZ13EEH5X2', name: 'tatyana', role: '' },
        { uid: 'hU6c3LO4j1aMizHMZysG2p1MWvi2', name: 'КонстТани' }
    ];

    it('tells them apart by role and the end of the id', () => {
        expect(contactHint(all[0], all, 'новый диалог')).toBe('Explorer · id …fB62 · новый диалог');
        expect(contactHint(all[1], all)).toBe('id …H5X2');
    });

    it('leaves a unique name as it was', () => {
        expect(contactHint(all[2], all, 'новый диалог')).toBe('новый диалог');
        expect(contactHint(all[2], all)).toBeUndefined();
    });
});

describe('a conversation preview', () => {
    it('shows text without its markup', () => {
        expect(plainText('**Шаги выполнения:**\n\n1. **Created** `~/check/sales10.csv`\n```py\nprint(1)\n```'))
            .toBe('Шаги выполнения: 1. Created ~/check/sales10.csv print(1)');
    });
});
