import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { BoardMember } from '../types';
import { SavedBot, toSavedBot, upsertSavedBot } from './botLibraryCore';

export type { SavedBot } from './botLibraryCore';

/**
 * Storage of "My bots" (see ./botLibraryCore): one document in the user's
 * private space, users/{uid}/private/bots, which only its owner can read or
 * write. Tool tokens are not part of it — they stay in the browser's settings.
 */

const libraryRef = (uid: string) => doc(db, 'users', uid, 'private', 'bots');

const readList = (data: any): SavedBot[] => Array.isArray(data?.bots) ? data.bots : [];

/** Undefined fields are rejected by Firestore. */
const clean = (bot: SavedBot): SavedBot => {
    const out: any = { ...bot };
    Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
    return out;
};

export const subscribeToBotLibrary = (uid: string, callback: (bots: SavedBot[]) => void) =>
    onSnapshot(
        libraryRef(uid),
        snap => callback(readList(snap.data())),
        error => {
            console.error('[Bots] Library subscription error:', error);
            callback([]);
        }
    );

export const saveBotToLibrary = (uid: string, member: BoardMember): Promise<void> =>
    runTransaction(db, async tx => {
        const snap = await tx.get(libraryRef(uid));
        const bots = upsertSavedBot(readList(snap.data()), toSavedBot(member)).map(clean);
        tx.set(libraryRef(uid), { bots, updatedAt: Date.now() });
    });

export const removeBotFromLibrary = (uid: string, botId: string): Promise<void> =>
    runTransaction(db, async tx => {
        const snap = await tx.get(libraryRef(uid));
        const bots = readList(snap.data()).filter(b => b.id !== botId);
        tx.set(libraryRef(uid), { bots, updatedAt: Date.now() });
    });
