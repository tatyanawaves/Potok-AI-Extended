import { describe, it, expect } from 'vitest';
import {
    usageFrom, addUsage, spendOn, dayKey, estimateDiscussionRequests, formatTokens, EMPTY_USAGE
} from '../services/usage';

describe('usageFrom', () => {
    it('reads the OpenAI-compatible shape', () => {
        expect(usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }))
            .toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 });
    });

    it('reads the Gemini shape', () => {
        expect(usageFrom({ usage: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }))
            .toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it('derives the total when only the parts are given', () => {
        expect(usageFrom({ usage: { prompt_tokens: 7, completion_tokens: 3 } }).totalTokens).toBe(10);
    });

    it('returns zeroes rather than NaN when the provider says nothing', () => {
        // Free models often omit usage entirely. An undercount is a worse
        // counter; a NaN is a broken screen.
        expect(usageFrom({})).toEqual(EMPTY_USAGE);
        expect(usageFrom(null)).toEqual(EMPTY_USAGE);
        expect(usageFrom({ usage: { prompt_tokens: 'many' } }).promptTokens).toBe(0);
    });
});

describe('addUsage', () => {
    it('sums the rounds of one turn', () => {
        const a = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };
        const b = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
        expect(addUsage(a, b)).toEqual({ promptTokens: 11, completionTokens: 22, totalTokens: 33 });
    });
});

describe('spendOn', () => {
    it('returns the tally for the day', () => {
        const state = { days: { '2026-09-08': { requests: 4, tokens: 900 } } };
        expect(spendOn(state, '2026-09-08')).toEqual({ requests: 4, tokens: 900 });
    });

    it('reads zero for a day with no activity, and for no state at all', () => {
        expect(spendOn({ days: {} }, '2026-09-08')).toEqual({ requests: 0, tokens: 0 });
        expect(spendOn(null)).toEqual({ requests: 0, tokens: 0 });
    });
});

describe('dayKey', () => {
    it('pads month and day so keys sort as text', () => {
        expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('follows the local calendar, not UTC', () => {
        // Spend is shown to one person; a day that flips at midnight somewhere
        // else would show yesterday's tally as today's.
        const lateEvening = new Date(2026, 8, 8, 23, 30);
        expect(dayKey(lateEvening)).toBe('2026-09-08');
    });
});

describe('estimateDiscussionRequests', () => {
    it('counts a request per bot per round', () => {
        expect(estimateDiscussionRequests(3, 2)).toBe(6);
    });

    it('multiplies by the tool rounds a turn may take', () => {
        // The number shown before a run is a ceiling on purpose: the point is
        // to reveal that a discussion with tools can cost far more than turns.
        expect(estimateDiscussionRequests(4, 6, 5)).toBe(120);
    });

    it('never returns a negative or a nonsense estimate', () => {
        expect(estimateDiscussionRequests(-1, 3)).toBe(0);
        expect(estimateDiscussionRequests(2, 3, 0)).toBe(6);
    });
});

describe('formatTokens', () => {
    it('keeps small numbers exact and shortens large ones', () => {
        expect(formatTokens(940)).toBe('940');
        expect(formatTokens(1500)).toBe('1.5K');
        expect(formatTokens(48200)).toBe('48K');
        expect(formatTokens(2_400_000)).toBe('2.4M');
    });
});
