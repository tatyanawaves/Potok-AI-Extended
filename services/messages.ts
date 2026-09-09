import {
    collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
    getDoc, getDocs, query, where, onSnapshot, limit, orderBy, arrayUnion
} from 'firebase/firestore';
import { deleteAttachments } from './attachments';
import { db } from './firebase';
import { Conversation, ConversationParticipant, DirectMessage, MessageAttachment } from '../types';

/**
 * Direct messages between two people.
 *
 *   conversations/{conversationId}
 *   conversations/{conversationId}/messages/{messageId}
 *
 * Nested for the same reason boards are: security rules take the conversation
 * id from the document path and check membership with one cached lookup.
 */

export const conversationsRef = collection(db, 'conversations');

export const messagesRefFor = (conversationId: string) =>
    collection(db, 'conversations', conversationId, 'messages');

/**
 * A conversation's id is derived from its two participants.
 *
 * Deterministic on purpose: without it, both people opening the thread at the
 * same moment would each create one and the conversation would silently split
 * in two.
 */
export const conversationIdFor = (a: string, b: string): string =>
    `dm_${[a, b].sort().join('_')}`;

export const otherParticipant = (
    conversation: Conversation,
    selfId: string
): ConversationParticipant | undefined =>
    conversation.participants.find(p => p.id !== selfId);

/** Opens the thread with someone, creating it on first use. */
export const openConversation = async (
    self: ConversationParticipant,
    other: ConversationParticipant
): Promise<string> => {
    if (self.id === other.id) throw new Error('Cannot open a conversation with yourself');

    const id = conversationIdFor(self.id, other.id);
    const ref = doc(db, 'conversations', id);
    const existing = await getDoc(ref);

    if (!existing.exists()) {
        const now = Date.now();
        await setDoc(ref, {
            participants: [self, other],
            participantIds: [self.id, other.id].sort(),
            createdAt: now,
            updatedAt: now
        });
    }

    return id;
};

export const subscribeToConversations = (
    userId: string,
    callback: (conversations: Conversation[]) => void
) => {
    const q = query(
        conversationsRef,
        where('participantIds', 'array-contains', userId),
        limit(100)
    );

    return onSnapshot(q, snapshot => {
        const conversations = (snapshot.docs
            .map(d => ({ id: d.id, ...d.data() })) as Conversation[])
            // Hidden by this user: still live for the other participant, but
            // gone from this list.
            .filter(c => !(c.deletedFor || []).includes(userId));

        // Sorted client-side: ordering by updatedAt alongside the
        // array-contains filter would need a composite index.
        conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        callback(conversations);
    }, error => {
        console.error('[Messages] Conversation subscription error:', error);
    });
};

export const subscribeToMessages = (
    conversationId: string,
    callback: (messages: DirectMessage[]) => void
) => {
    const q = query(messagesRefFor(conversationId), orderBy('timestamp', 'asc'), limit(300));

    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as DirectMessage[]);
    }, error => {
        console.error('[Messages] Message subscription error:', error);
    });
};

export const sendDirectMessage = async (
    conversationId: string,
    author: ConversationParticipant,
    content: string,
    attachments: MessageAttachment[] = []
) => {
    const trimmed = content.trim();
    // A message carrying only files is still a message.
    if (!trimmed && attachments.length === 0) {
        throw new Error('Cannot send an empty message');
    }

    const timestamp = Date.now();

    const created = await addDoc(messagesRefFor(conversationId), {
        conversationId,
        authorId: author.id,
        authorName: author.name,
        content: trimmed,
        ...(attachments.length ? { attachments } : {}),
        timestamp
    });

    // Keeps the conversation list ordered and previewable without reading
    // every thread's messages.
    await updateDoc(doc(db, 'conversations', conversationId), {
        updatedAt: timestamp,
        lastMessage: {
            content: trimmed || `📎 ${attachments.map(a => a.name).join(', ')}`,
            authorId: author.id,
            timestamp
        }
    });

    return created;
};

export const editDirectMessage = async (
    conversationId: string,
    messageId: string,
    content: string
) => {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Cannot save an empty message');

    await updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
        content: trimmed,
        editedAt: Date.now()
    });
};

/**
 * Marks a message deleted without removing the document.
 *
 * A tombstone rather than a hard delete: the other person may already have
 * read it, and a vanished message reads as a glitch where "message deleted"
 * reads as a decision.
 */
export const deleteDirectMessage = async (conversationId: string, messageId: string) => {
    await updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
        deletedAt: Date.now(),
        content: '',
        // Cleared alongside the text: the files themselves are removed from
        // storage, so leaving the references would render as broken tiles.
        attachments: []
    });
};

/** Removes the tombstone too. Only meaningful for the author's own message. */
export const purgeDirectMessage = async (conversationId: string, messageId: string) => {
    await deleteDoc(doc(db, 'conversations', conversationId, 'messages', messageId));
};

/**
 * Removes a conversation for one participant.
 *
 * The thread belongs to two people, so this hides it rather than destroying
 * the other person's copy. When the second participant does the same there is
 * nobody left to keep it for, and the messages and their files are purged.
 *
 * Returns whether that final purge happened, which is worth telling the user:
 * "removed from your list" and "gone for good" are different outcomes.
 */
export const deleteConversation = async (
    conversationId: string,
    userId: string
): Promise<{ purged: boolean }> => {
    const ref = doc(db, 'conversations', conversationId);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return { purged: false };

    const conversation = snapshot.data() as Conversation;
    const others = (conversation.participantIds || []).filter(id => id !== userId);
    const alreadyHiddenByOther = others.every(id => (conversation.deletedFor || []).includes(id));

    if (!alreadyHiddenByOther) {
        await updateDoc(ref, { deletedFor: arrayUnion(userId) });
        return { purged: false };
    }

    // Both sides are done with it. Files go before the documents naming them,
    // since their keys live nowhere else.
    const messages = await getDocs(messagesRefFor(conversationId));

    await deleteAttachments(
        messages.docs.flatMap(m => (m.data() as DirectMessage).attachments || [])
    );

    await Promise.all(messages.docs.map(m => deleteDoc(m.ref)));
    await deleteDoc(ref);

    return { purged: true };
};
