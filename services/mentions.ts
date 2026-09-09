import { BoardMember } from '../types';

/**
 * Pure helpers shared by the board code.
 *
 * Kept free of imports from ./firebase on purpose: that module opens a
 * Firestore connection at import time, which makes anything importing it
 * untestable without a live SDK. These are the two functions that have already
 * caused bugs, so they are the ones worth isolating.
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
