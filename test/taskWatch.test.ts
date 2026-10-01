import { describe, it, expect } from 'vitest';
import { newlyFinished, finishedText } from '../services/taskWatch';

const task = (status: any, startedBy = 'me', id = 't1') => ({ id, status, startedBy, task: 'Найти простые числа', progress: 100 });

describe('newlyFinished', () => {
    it('reports a task of mine that went from running to done, once', () => {
        const seen = new Map<string, string>();
        expect(newlyFinished(seen, [task('running')], 'me')).toEqual([]);
        expect(newlyFinished(seen, [task('done')], 'me')).toHaveLength(1);
        expect(newlyFinished(seen, [task('done')], 'me')).toEqual([]);
    });

    it('ignores tasks already finished when first seen, and other people\'s tasks', () => {
        const seen = new Map<string, string>();
        expect(newlyFinished(seen, [task('done'), task('running', 'someone', 't2')], 'me')).toEqual([]);
        expect(newlyFinished(seen, [task('done'), task('failed', 'someone', 't2')], 'me')).toEqual([]);
    });
});

describe('finishedText', () => {
    it('says how it ended, in the user\'s language', () => {
        expect(finishedText(task('done'), 'ru')).toBe('Задача готова · 100%: Найти простые числа');
        expect(finishedText(task('failed'), 'en')).toBe('Task failed: Найти простые числа');
    });
});
