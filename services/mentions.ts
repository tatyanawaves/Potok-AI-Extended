import { Board, BoardMember } from '../types';

/**
 * Pure helpers shared by the board code.
 *
 * Kept free of imports from ./firebase on purpose: that module opens a
 * Firestore connection at import time, which makes anything importing it
 * untestable without a live SDK. These are the functions that have already
 * caused bugs or that decide who may post as whom, so they are the ones worth
 * isolating.
 */

/**
 * Extracts @mentions from message text.
 *
 * Deliberately not `/@name\b/`: \b is an ASCII word boundary, so a Cyrillic
 * name followed by a space has no boundary between them and never matched.
 * The Unicode property escapes below cover any alphabet.
 */
export const parseMentions = (text: string): string[] => {
    const matches = text.match(/@([\p{L}\p{N}_-]+)/gu) || [];
    return [...new Set(matches.map(m => m.slice(1)))];
};

/**
 * Board members that answer @mentions.
 * 'agent' is the pre-bot spelling, still present on boards created earlier.
 */
export const isBot = (member: BoardMember): boolean =>
    member.type === 'bot' || member.type === 'agent';

/**
 * Ids any member of a board may post under: its bots (see firestore.rules).
 *
 * 'bot' members only. A bot gets an id generated for it, but a legacy 'agent'
 * member was a real account added by its uid — listing it would let every
 * member of the board post as that person.
 */
export const botIdsOf = (members: BoardMember[]): string[] =>
    [...new Set(members.filter(m => m.type === 'bot').map(m => m.id))];

/** Whether a board's stored botIds match its roster. */
export const botIdsInSync = (board: Pick<Board, 'members' | 'botIds'>): boolean => {
    const wanted = botIdsOf(board.members);
    const stored = new Set(board.botIds || []);
    return wanted.length === stored.size && wanted.every(id => stored.has(id));
};

/** Longest bot name kept; a mention is typed by hand. */
const MAX_NAME_LENGTH = 32;

/**
 * A name that parseMentions can find again. Bots were created as
 * "Аналитик данных" or cloned from a persona called "Dr. Who", and then
 * `@Аналитик данных` matched "Аналитик" — the bot silently never answered.
 * Spaces become underscores; anything else a mention cannot hold is dropped.
 */
export const mentionableName = (name: string): string =>
    name.trim().replace(/^@+/, '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, MAX_NAME_LENGTH);

/** `name`, or `name2`, `name3`… — the first one nobody in `taken` has. */
export const freeName = (name: string, taken: string[]): string => {
    const used = new Set(taken.map(n => n.toLowerCase()));
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name}${n}`;
    return candidate;
};
