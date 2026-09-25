import {
    collection, addDoc, query, where, onSnapshot, limit, orderBy,
    doc, updateDoc, getDoc, getDocs, deleteDoc, arrayUnion, arrayRemove, runTransaction
} from 'firebase/firestore';
import { db } from './firebase';
import { isBot, parseMentions, botIdsOf, botIdsInSync } from './mentions';
import { deleteAttachments } from './attachments';
import { listenWithRetry } from './listen';
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

/** How many of a channel's latest messages are kept on screen. */
const MESSAGE_WINDOW = 200;

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

        // Attachment keys live only on the messages, so the files have to go
        // before the documents naming them do.
        await deleteAttachments(
            messages.docs.flatMap(m => (m.data() as BoardMessage).attachments || [])
        );

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
        toolServerUrls?: string[];
    }
) => {
    if (!bot.name.trim()) throw new Error('A bot needs a name');
    const urls = [bot.toolServerUrl, ...(bot.toolServerUrls || [])]
        .map(u => u?.trim()).filter((u): u is string => Boolean(u));

    return addMember(boardId, {
        id: generateId(),
        name: bot.name.trim(),
        type: 'bot',
        systemPrompt: bot.systemPrompt.trim() || undefined,
        model: bot.model || undefined,
        toolServerUrl: urls[0],
        toolServerUrls: urls.length > 1 ? urls.slice(1) : undefined,
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

    // The rules let members post under a bot's id only once it is listed here.
    const botIds = botIdsOf([fullMember]);

    await updateDoc(doc(db, 'boards', boardId), {
        members: arrayUnion(cleanMember),
        memberIds: arrayUnion(member.id),
        ...(botIds.length ? { botIds: arrayUnion(...botIds) } : {})
    });
};

/**
 * Changes a bot after it was created: its name, prompt, model and tools.
 *
 * The roster is an array on the board, so the whole array is rewritten with
 * the one member replaced — the security rules let only the owner do that.
 * In a transaction: rewriting from a copy read earlier dropped whatever
 * changed in between, e.g. a second tool attached from the advisor a moment
 * after the first.
 */
export const updateBot = async (
    boardId: string,
    botId: string,
    changes: {
        name?: string,
        systemPrompt?: string,
        /** Empty string: back to the model in the user's settings. */
        model?: string,
        toolServerUrls?: string[],
        /** Added to the bot's current servers, as they are at write time. */
        addToolServerUrls?: string[]
    }
) => {
    const ref = doc(db, 'boards', boardId);
    await runTransaction(db, async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw new Error('Доска не найдена');
        const board = snapshot.data() as Board;

        const name = changes.name?.trim();
        if (name && board.members.some(m => m.id !== botId && m.name.toLowerCase() === name.toLowerCase())) {
            throw new Error('Участник с таким именем уже есть — упоминания станут неоднозначными');
        }

        const members = board.members.map(m => {
            if (m.id !== botId) return m;
            const base = changes.toolServerUrls ?? toolUrlsOf(m);
            const urls = [...new Set([...base, ...(changes.addToolServerUrls || [])].map(u => u.trim()).filter(Boolean))];
            const next: any = { ...m, systemPrompt: changes.systemPrompt ?? m.systemPrompt };
            if (name) next.name = name;
            if (changes.model !== undefined) next.model = changes.model.trim() || undefined;
            // One primary URL kept for older clients, the rest alongside.
            if (urls.length) { next.toolServerUrl = urls[0]; next.toolServerUrls = urls.slice(1); }
            else { delete next.toolServerUrl; delete next.toolServerUrls; }
            Object.keys(next).forEach(k => next[k] === undefined && delete next[k]);
            return next;
        });

        tx.update(ref, { members });
    });
};

const toolUrlsOf = (m: BoardMember): string[] =>
    [m.toolServerUrl, ...(m.toolServerUrls || [])].filter((u): u is string => Boolean(u));

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
        memberIds: arrayRemove(memberId),
        botIds: arrayRemove(memberId)
    });
};

/**
 * Rewrites a board's botIds from its roster, if they differ.
 *
 * Boards from before botIds existed lack it, and a bot added from a tab still
 * running older code is missing from it; either way no member could post that
 * bot's replies. Only the owner may write the field, so this is a no-op for
 * everyone else — scripts/migrate-rules-data.mjs covers boards whose owner
 * does not come back.
 */
export const syncBotIds = async (board: Board, uid: string) => {
    if (!board.id || board.ownerId !== uid || botIdsInSync(board)) return;
    await updateDoc(doc(db, 'boards', board.id), { botIds: botIdsOf(board.members) });
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

export const subscribeToChannels = (boardId: string, callback: (channels: BoardChannel[]) => void) =>
    // Retried: right after a board is created the server may not have it yet.
    listenWithRetry(onError => onSnapshot(query(channelsRefFor(boardId), limit(50)), (snapshot) => {
        const channels = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardChannel[];
        channels.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        callback(channels);
    }, onError), 'Boards/channels');

export const deleteChannel = async (boardId: string, channelId: string) => {
    const messages = await getDocs(messagesRefFor(boardId, channelId));

    await deleteAttachments(
        messages.docs.flatMap(m => (m.data() as BoardMessage).attachments || [])
    );

    await Promise.all(messages.docs.map(m => deleteDoc(m.ref)));
    await deleteDoc(doc(db, 'boards', boardId, 'channels', channelId));
};

// --- Messages ---

export const subscribeToMessages = (
    boardId: string,
    channelId: string,
    callback: (messages: BoardMessage[]) => void
) => {
    // Newest first, then flipped: a bare limit() returns documents in id
    // order, which for random ids is no order at all — past the limit a
    // channel showed an arbitrary 200 messages and hid the latest ones.
    const q = query(messagesRefFor(boardId, channelId), orderBy('timestamp', 'desc'), limit(MESSAGE_WINDOW));

    return listenWithRetry(onError => onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMessage[];
        messages.reverse();
        callback(messages);
    }, onError), 'Boards/messages');
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

    const created = await addDoc(messagesRefFor(message.boardId, message.channelId), payload);

    // Stamped on the channel and the board so unread dots cost no extra reads.
    // Best effort: a message that arrived must not disappear because the
    // bookkeeping behind a dot failed.
    const stamp = { lastMessageAt: payload.timestamp, lastMessageAuthorId: message.authorId };

    await Promise.all([
        updateDoc(doc(db, 'boards', message.boardId, 'channels', message.channelId), stamp),
        updateDoc(doc(db, 'boards', message.boardId), stamp)
    ]).catch(error => console.error('[Boards] Could not stamp last message:', error));

    return created;
};

export const deleteMessage = async (boardId: string, channelId: string, messageId: string) => {
    await deleteDoc(doc(db, 'boards', boardId, 'channels', channelId, 'messages', messageId));
};

/**
 * Messages newer than a moment, oldest first, at most `count` of the newest.
 *
 * What a bot turn reads: everything its channel summary does not cover yet.
 * Once memory has folded the old part of a channel into its summary, this
 * stays a handful of documents however long the channel grows.
 */
export const getMessagesSince = async (
    boardId: string,
    channelId: string,
    since: number,
    count: number
): Promise<BoardMessage[]> => {
    const snapshot = await getDocs(query(
        messagesRefFor(boardId, channelId),
        where('timestamp', '>', since),
        orderBy('timestamp', 'desc'),
        limit(count)
    ));
    const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMessage[];
    return messages.reverse();
};

/** Recent messages of a channel, oldest first — used to build agent context. */
export const getRecentMessages = async (
    boardId: string,
    channelId: string,
    count: number
): Promise<BoardMessage[]> => {
    // Ordered on the server for the same reason as subscribeToMessages: the
    // bots' context has to be the latest messages, not a random sample.
    const snapshot = await getDocs(
        query(messagesRefFor(boardId, channelId), orderBy('timestamp', 'desc'), limit(count))
    );
    const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMessage[];
    return messages.reverse();
};
