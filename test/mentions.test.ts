import { describe, it, expect } from 'vitest';
import { parseMentions, isBot, botIdsOf, botIdsInSync } from '../services/mentions';

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

describe('botIdsOf', () => {
    const member = (id: string, type: string) => ({ id, type } as any);

    it('lists bots once each', () => {
        expect(botIdsOf([member('b1', 'bot'), member('b2', 'bot'), member('b1', 'bot')])).toEqual(['b1', 'b2']);
    });

    it('leaves out humans and legacy agents', () => {
        // A legacy 'agent' member's id is a real account's uid. The rules let
        // any member post under an id in botIds, so listing it would let them
        // post as that person.
        expect(botIdsOf([member('u1', 'human'), member('u2', 'agent'), member('b1', 'bot')])).toEqual(['b1']);
    });
});

describe('botIdsInSync', () => {
    const members = [{ id: 'owner', type: 'human' }, { id: 'b1', type: 'bot' }, { id: 'b2', type: 'bot' }] as any[];

    it('accepts the same ids in any order', () => {
        expect(botIdsInSync({ members, botIds: ['b2', 'b1'] })).toBe(true);
    });

    it('flags a board from before botIds existed', () => {
        expect(botIdsInSync({ members })).toBe(false);
    });

    it('flags a bot missing from the list, or one that was removed', () => {
        expect(botIdsInSync({ members, botIds: ['b1'] })).toBe(false);
        expect(botIdsInSync({ members, botIds: ['b1', 'b2', 'gone'] })).toBe(false);
    });

    it('accepts an empty list on a board without bots', () => {
        expect(botIdsInSync({ members: [members[0]], botIds: [] })).toBe(true);
    });
});
