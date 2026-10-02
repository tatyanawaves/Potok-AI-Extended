import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { BoardMember } from '../types';
import { mentionedPeople, mentionLink } from './mentions';

export { mentionedPeople, mentionLink };

/**
 * Telling a person they were @mentioned on a board. A notice goes into
 * users/{uid}/notifications, which only they read; the rules let a member
 * write one only for another member of the same board, in their own name.
 */

export interface MentionNotice {
    id: string;
    from: string;
    fromName: string;
    boardId: string;
    boardName: string;
    channelId: string;
    channelName: string;
    threadId?: string;
    text: string;
    createdAt: number;
    read: boolean;
}

export const notifyMentioned = async (options: {
    people: BoardMember[];
    from: { id: string, name: string };
    board: { id: string, name: string };
    channel: { id: string, name: string };
    threadId?: string;
    text: string;
}): Promise<void> => {
    const { people, from, board, channel, threadId, text } = options;
    await Promise.all(people.map(person => addDoc(collection(db, 'users', person.id, 'notifications'), {
        from: from.id,
        fromName: from.name.slice(0, 80),
        boardId: board.id,
        boardName: board.name.slice(0, 120),
        channelId: channel.id,
        channelName: channel.name.slice(0, 80),
        ...(threadId ? { threadId } : {}),
        text: text.slice(0, 300),
        createdAt: Date.now(),
        read: false
    }).catch(error => console.warn('[Mentions] Could not notify', person.name, error))));
};

export const subscribeToMentions = (uid: string, callback: (notices: MentionNotice[]) => void) =>
    onSnapshot(
        // Newest first and unread kept here: read == false plus an order would need a composite index.
        query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(30)),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as MentionNotice).filter(n => !n.read)),
        () => callback([])
    );

export const markMentionRead = (uid: string, id: string) =>
    updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true });
