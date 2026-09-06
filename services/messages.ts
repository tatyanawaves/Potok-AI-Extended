import {
    collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
    getDoc, query, where, onSnapshot, limit, orderBy
} from 'firebase/firestore';
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
        const conversations = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() })) as Conversation[];

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
