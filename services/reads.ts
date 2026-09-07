import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { ReadState } from '../types';
import { EMPTY_READ_STATE, isBoardUnread, isChannelUnread, isConversationUnread } from './unread';

/**
 * What you have already seen.
 *
 * Read marks are private: they live in users/{uid}/private/reads, a single
 * document, rather than on the conversation or channel. Two reasons:
 *
 *  - the profile document under users/{uid} is world-readable, and when
 *    somebody last looked at a thread is nobody else's business;
 *  - one document means one subscription for the whole app, instead of a
 *    listener per board or a write to a shared document on every glance.
 *
 * Nothing here is authoritative — it only decides whether a dot is drawn. A
 * stale or missing mark shows an extra unread badge, never someone else's
 * content.
 */

const readsRefFor = (uid: string) => doc(db, 'users', uid, 'private', 'reads');

// Re-exported so callers have one place to import from; defined in ./unread,
// which stays free of the Firestore connection this module opens.
export { EMPTY_READ_STATE, isBoardUnread, isChannelUnread, isConversationUnread };

export const subscribeToReadState = (uid: string, callback: (state: ReadState) => void) =>
    onSnapshot(readsRefFor(uid), snapshot => {
        callback(snapshot.exists() ? { ...EMPTY_READ_STATE, ...snapshot.data() } as ReadState : EMPTY_READ_STATE);
    }, error => {
        // Losing read marks costs a stray dot, so the app carries on with none
        // rather than failing the view around them.
        console.error('[Reads] Could not follow read state:', error);
        callback(EMPTY_READ_STATE);
    });

/** Records that everything up to now in this place has been seen. */
export const markRead = async (
    uid: string,
    place: { channelId: string, boardId: string } | { conversationId: string }
): Promise<void> => {
    const now = Date.now();

    const patch = 'conversationId' in place
        ? { conversations: { [place.conversationId]: now } }
        : { channels: { [place.channelId]: now }, boards: { [place.boardId]: now } };

    // merge, so marking one place read does not erase the others.
    await setDoc(readsRefFor(uid), patch, { merge: true });
};
