import { describe, it, expect } from 'vitest';
import { parseMentions, isBot } from '../services/mentions';

describe('parseMentions', () => {
    it('finds a Latin name', () => {
        expect(parseMentions('@Neonova привет')).toEqual(['Neonova']);
    });

    it('finds a Cyrillic name', () => {
        // Regression: the send path used /@name\b/, and \b is an ASCII word
        // boundary. After "г" in "@Маркетолог " both sides are non-word
        // characters, so no boundary existed, the mention went unmatched, and
        // the bot silently never replied.
        expect(parseMentions('@Маркетолог придумай слоган')).toEqual(['Маркетолог']);
    });

    it('finds a name at the very end of the message', () => {
        expect(parseMentions('вопрос к @Советник')).toEqual(['Советник']);
    });

    it('finds several names and drops duplicates', () => {
        expect(parseMentions('@Docs и @Гитхаб, снова @Docs'))
            .toEqual(['Docs', 'Гитхаб']);
    });

    it('accepts digits, underscores and hyphens inside a name', () => {
        expect(parseMentions('@bot_2 и @agent-x')).toEqual(['bot_2', 'agent-x']);
    });

    it('stops at punctuation', () => {
        expect(parseMentions('@Neo, привет')).toEqual(['Neo']);
    });

    it('returns nothing when there is no mention', () => {
        expect(parseMentions('обычное сообщение без адресата')).toEqual([]);
    });

    it('ignores a bare @', () => {
        expect(parseMentions('почта вида @ и всё')).toEqual([]);
    });
});

describe('isBot', () => {
    const member = (type: string) => ({ type } as any);

    it('recognises the current spelling', () => {
        expect(isBot(member('bot'))).toBe(true);
    });

    it('recognises the legacy spelling', () => {
        // Boards created before bots were introduced store type 'agent'.
        // Dropping this made those bots stop answering and undercounted the
        // "N AI" badge on the board list.
        expect(isBot(member('agent'))).toBe(true);
    });

    it('rejects humans', () => {
        expect(isBot(member('human'))).toBe(false);
    });
});
