import {
    collection, addDoc, query, where, onSnapshot, limit,
    doc, updateDoc, getDoc, getDocs, deleteDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from './firebase';
import { isBot, parseMentions } from './mentions';
import { Board, BoardChannel, BoardMember, BoardMessage } from '../types';

/**
 * Boards are stored as nested subcollections:
 *
 *   boards/{boardId}
 *   boards/{boardId}/channels/{channelId}
 *   boards/{boardId}/channels/{channelId}/messages/{messageId}
 *
 * The nesting matters for security rules: it lets them derive the board id
 * from the document path and check membership with a single cached get(),
 * instead of one lookup per document in a query (which Firestore rejects).
 */

export const boardsRef = collection(db, 'boards');

export const channelsRefFor = (boardId: string) =>
    collection(db, 'boards', boardId, 'channels');

export const messagesRefFor = (boardId: string, channelId: string) =>
    collection(db, 'boards', boardId, 'channels', channelId, 'messages');

const DEFAULT_CHANNEL_NAME = 'general';

// Re-exported so existing imports keep working; defined in ./mentions, which
// stays free of the Firestore connection this module opens.
export { isBot, parseMentions };

// --- Boards ---

export const createBoard = async (name: string, description: string, owner: { id: string, name: string }) => {
    const ownerMember: BoardMember = {
        id: owner.id,
        name: owner.name,
        type: 'human',
        role: 'owner',
        addedAt: Date.now()
    };

    const boardDoc = await addDoc(boardsRef, {
        name,
        description,
        ownerId: owner.id,
        members: [ownerMember],
        memberIds: [owner.id],
        createdAt: Date.now()
    });

    // Every board starts with a #general channel so it is usable immediately.
    await createChannel(boardDoc.id, DEFAULT_CHANNEL_NAME, '');

    return boardDoc;
};

export const subscribeToMyBoards = (userId: string, callback: (boards: Board[]) => void) => {
    const q = query(boardsRef, where('memberIds', 'array-contains', userId), limit(50));

    return onSnapshot(q, (snapshot) => {
        const boards = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Board[];
        // Sorted client-side to avoid requiring a composite index.
        boards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        callback(boards);
    }, (error) => {
        console.error('[Boards] Board subscription error:', error);
    });
};

export const getBoard = async (boardId: string): Promise<Board | null> => {
    const snapshot = await getDoc(doc(db, 'boards', boardId));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Board) : null;
};

export const deleteBoard = async (boardId: string) => {
    const channels = await getDocs(channelsRefFor(boardId));

    for (const channelDoc of channels.docs) {
        const messages = await getDocs(messagesRefFor(boardId, channelDoc.id));
        await Promise.all(messages.docs.map(m => deleteDoc(m.ref)));
        await deleteDoc(channelDoc.ref);
    }

    await deleteDoc(doc(db, 'boards', boardId));
};

// --- Members ---

const generateId = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Adds a bot to a board.
 *
 * Bots belong to the board, not to the network: they get their own generated
 * id rather than reusing an agent profile's uid. That keeps billing honest —
 * `ownerId` is whoever created the bot, and it is their quota that answers,
 * never the quota of the person who happens to @mention it.
 */
export const addBot = async (
    boardId: string,
    bot: {
        name: string;
        systemPrompt: string;
        model?: string;
        ownerId: string;
        sourceAgentId?: string;
        sourceAgentName?: string;
        toolServerUrl?: string;
    }
) => {
    if (!bot.name.trim()) throw new Error('A bot needs a name');

    return addMember(boardId, {
        id: generateId(),
        name: bot.name.trim(),
        type: 'bot',
        systemPrompt: bot.systemPrompt.trim() || undefined,
        model: bot.model || undefined,
        toolServerUrl: bot.toolServerUrl?.trim() || undefined,
        ownerId: bot.ownerId,
        sourceAgentId: bot.sourceAgentId,
        sourceAgentName: bot.sourceAgentName,
        respondsToMentions: true
    });
};

export const addMember = async (boardId: string, member: Omit<BoardMember, 'addedAt' | 'role'>) => {
    if (!member.id || !member.name) {
        throw new Error('Cannot add a member without an id and a name');
    }

    const fullMember: BoardMember = {
        ...member,
        role: 'member',
        addedAt: Date.now()
    };

    // Strip undefined fields — Firestore rejects them.
    const cleanMember = Object.keys(fullMember).reduce((acc: any, key) => {
        if ((fullMember as any)[key] !== undefined) acc[key] = (fullMember as any)[key];
        return acc;
    }, {});

    await updateDoc(doc(db, 'boards', boardId), {
        members: arrayUnion(cleanMember),
        memberIds: arrayUnion(member.id)
    });
};

export const removeMember = async (boardId: string, memberId: string) => {
    const board = await getBoard(boardId);
    if (!board) return;

    const member = board.members.find(m => m.id === memberId);
    if (!member) return;

    if (member.role === 'owner') {
        throw new Error('Cannot remove the board owner');
    }

    await updateDoc(doc(db, 'boards', boardId), {
        members: board.members.filter(m => m.id !== memberId),
        memberIds: arrayRemove(memberId)
    });
};

// --- Channels ---

export const createChannel = async (boardId: string, name: string, topic: string) => {
    return addDoc(channelsRefFor(boardId), {
        boardId,
        name: name.replace(/^#/, '').trim(),
        topic,
        createdAt: Date.now()
    });
};

export const subscribeToChannels = (boardId: string, callback: (channels: BoardChannel[]) => void) => {
    return onSnapshot(query(channelsRefFor(boardId), limit(50)), (snapshot) => {
        const channels = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardChannel[];
        channels.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        callback(channels);
    }, (error) => {
        console.error('[Boards] Channel subscription error:', error);
    });
};

export const deleteChannel = async (boardId: string, channelId: string) => {
    const messages = await getDocs(messagesRefFor(boardId, channelId));
    await Promise.all(messages.docs.map(m => deleteDoc(m.ref)));
    await deleteDoc(doc(db, 'boards', boardId, 'channels', channelId));
};

// --- Messages ---

export const subscribeToMessages = (
    boardId: string,
    channelId: string,
    callback: (messages: BoardMessage[]) => void
) => {
    return onSnapshot(query(messagesRefFor(boardId, channelId), limit(200)), (snapshot) => {
        const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMessage[];
        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        callback(messages);
    }, (error) => {
        console.error('[Boards] Message subscription error:', error);
    });
};

export const sendMessage = async (message: Omit<BoardMessage, 'id' | 'timestamp' | 'mentions'>) => {
    const payload: any = {
        ...message,
        mentions: parseMentions(message.content),
        timestamp: Date.now()
    };

    Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) delete payload[key];
    });

    return addDoc(messagesRefFor(message.boardId, message.channelId), payload);
};

export const deleteMessage = async (boardId: string, channelId: string, messageId: string) => {
    await deleteDoc(doc(db, 'boards', boardId, 'channels', channelId, 'messages', messageId));
};

/** Recent messages of a channel, oldest first — used to build agent context. */
export const getRecentMessages = async (
    boardId: string,
    channelId: string,
    count: number
): Promise<BoardMessage[]> => {
    const snapshot = await getDocs(query(messagesRefFor(boardId, channelId), limit(200)));
    const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMessage[];
    messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return messages.slice(-count);
};
