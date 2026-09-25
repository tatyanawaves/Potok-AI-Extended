import { describe, it, expect } from 'vitest';
import {
    estimateTokens, selectWindow, compactionBatch, parseSummary, rankByRelevance, terms,
    memoryBlock, selectTools, EMPTY_SUMMARY, WINDOW_MESSAGES, COMPACT_BATCH, MAX_MESSAGE_CHARS
} from '../services/memoryCore';
import { BoardMessage } from '../types';

const msg = (i: number, content = `message ${i}`): BoardMessage => ({
    id: String(i), channelId: 'c', boardId: 'b', authorId: 'u', authorName: 'Ann',
    authorType: 'human', content, mentions: [], timestamp: i
});

describe('estimateTokens', () => {
    it('counts Cyrillic denser than Latin', () => {
        expect(estimateTokens('a'.repeat(400))).toBe(100);
        expect(estimateTokens('я'.repeat(300))).toBe(100);
        expect(estimateTokens('')).toBe(0);
    });
});

describe('selectWindow', () => {
    it('keeps only the last few messages', () => {
        const history = Array.from({ length: 20 }, (_, i) => msg(i));
        const window = selectWindow(history);
        expect(window).toHaveLength(WINDOW_MESSAGES);
        expect(window.at(-1)!.id).toBe('19');
    });

    it('clips long messages and drops the oldest to fit the budget', () => {
        const history = Array.from({ length: 6 }, (_, i) => msg(i, 'x'.repeat(5000)));
        const window = selectWindow(history, 6, 500);
        expect(window.every(m => m.content.length <= MAX_MESSAGE_CHARS)).toBe(true);
        expect(window.length).toBeLessThan(6);
        expect(window.at(-1)!.id).toBe('5');
    });

    it('always keeps the newest message', () => {
        expect(selectWindow([msg(1, 'x'.repeat(5000))], 6, 10)).toHaveLength(1);
    });
});

describe('compactionBatch', () => {
    it('waits until a full batch has piled up beyond the window', () => {
        const few = Array.from({ length: WINDOW_MESSAGES + COMPACT_BATCH - 1 }, (_, i) => msg(i + 1));
        expect(compactionBatch(few, EMPTY_SUMMARY)).toEqual([]);

        const enough = Array.from({ length: WINDOW_MESSAGES + COMPACT_BATCH }, (_, i) => msg(i + 1));
        const batch = compactionBatch(enough, EMPTY_SUMMARY);
        expect(batch).toHaveLength(COMPACT_BATCH);
        expect(batch.at(-1)!.timestamp).toBe(COMPACT_BATCH);
    });

    it('ignores what the summary already covers', () => {
        const history = Array.from({ length: 30 }, (_, i) => msg(i + 1));
        const summary = { ...EMPTY_SUMMARY, coveredUntil: 20 };
        expect(compactionBatch(history, summary)).toEqual([]);
    });
});

describe('parseSummary', () => {
    it('reads summary and facts', () => {
        expect(parseSummary('{"summary":"S","facts":["a","",3,"b"]}', 'old')).toEqual({ summary: 'S', facts: ['a', 'b'] });
    });

    it('keeps the previous summary when the answer is empty JSON', () => {
        expect(parseSummary('{"summary":""}', 'old').summary).toBe('old');
    });

    it('uses plain text when there is no JSON', () => {
        expect(parseSummary('just text', 'old')).toEqual({ summary: 'just text', facts: [] });
    });
});

describe('retrieval', () => {
    it('stems Russian word forms to the same term', () => {
        expect(terms('отчёт отчёта Отчётом')).toEqual(['отчет', 'отчет', 'отчет']);
    });

    it('ranks the matching note first and drops unrelated ones', () => {
        const notes = [
            { text: 'Бюджет на рекламу — 50 тысяч в месяц' },
            { text: 'Созвон по пятницам в 11:00' },
            { text: 'Клиент просил отчёт по рекламе к понедельнику' }
        ];
        const found = rankByRelevance('сколько бюджет рекламы', notes, n => n.text, 3);
        expect(found[0]).toBe(notes[0]);
        expect(found).not.toContain(notes[1]);
    });

    it('returns nothing for an empty query', () => {
        expect(rankByRelevance('и в на', [{ t: 'x' }], d => d.t)).toEqual([]);
    });
});

describe('memoryBlock', () => {
    it('is empty for a new channel, so it costs nothing', () => {
        expect(memoryBlock(EMPTY_SUMMARY, [])).toBe('');
    });

    it('includes the summary and the notes', () => {
        const block = memoryBlock({ ...EMPTY_SUMMARY, text: 'We agreed X', coveredCount: 12 }, [{ text: 'fact', author: 'a', createdAt: 0 }]);
        expect(block).toContain('12 older messages');
        expect(block).toContain('We agreed X');
        expect(block).toContain('- fact');
    });
});

describe('selectTools', () => {
    const tools = Array.from({ length: 20 }, (_, i) => ({ name: `tool_${i}`, description: 'misc' }));

    it('passes a short list through untouched', () => {
        expect(selectTools(tools.slice(0, 5), 'anything')).toHaveLength(5);
    });

    it('caps a long list and puts the relevant tool first', () => {
        const withIssue = [...tools, { name: 'github_create_issue', description: 'Create an issue in a repository' }];
        const picked = selectTools(withIssue, 'create an issue for the bug', 12);
        expect(picked).toHaveLength(12);
        expect(picked[0].name).toBe('github_create_issue');
    });
});
