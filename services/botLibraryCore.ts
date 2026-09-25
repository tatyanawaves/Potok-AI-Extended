import { BoardMember } from '../types';

/**
 * "My bots": bots a person keeps for reuse, independent of any board.
 *
 * A bot used to exist only inside the board it was made in; the one way to
 * use it again elsewhere was to write its prompt and pick its tools anew.
 * Now its configuration — never a token — is kept in the person's private
 * space and can be added to any board they own.
 *
 * The pure part, kept free of Firestore so it can be tested; see
 * ./botLibrary for storage.
 */

export interface SavedBot {
    id: string;
    name: string;
    systemPrompt: string;
    model?: string;
    toolServerUrls: string[];
    savedAt: number;
}

/** Enough for anyone's toolbox, and far below Firestore's document limit. */
export const MAX_SAVED_BOTS = 100;

const newId = (): string =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** The reusable part of a board's bot: who it is and what it can use. */
export const toSavedBot = (member: BoardMember, now = Date.now()): SavedBot => {
    const urls = [member.toolServerUrl, ...(member.toolServerUrls || [])]
        .map(u => u?.trim()).filter((u): u is string => Boolean(u));
    const saved: SavedBot = {
        id: newId(),
        name: member.name,
        systemPrompt: member.systemPrompt || '',
        toolServerUrls: [...new Set(urls)],
        savedAt: now
    };
    if (member.model) saved.model = member.model;
    return saved;
};

/**
 * Adds a bot to the list, replacing a saved one of the same name — saving
 * again after editing a bot updates it rather than making a twin. Newest
 * first, capped.
 */
export const upsertSavedBot = (list: SavedBot[], bot: SavedBot): SavedBot[] => {
    const existing = list.find(b => b.name.toLowerCase() === bot.name.toLowerCase());
    const next = { ...bot, id: existing?.id || bot.id };
    return [next, ...list.filter(b => b !== existing)].slice(0, MAX_SAVED_BOTS);
};
