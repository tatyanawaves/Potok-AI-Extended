import { getDocs, query, where, limit } from 'firebase/firestore';
import { createPost } from './firebase';
import { boardsRef, channelsRefFor, sendMessage } from './boards';
import { conversationsRef, openConversation, sendDirectMessage, otherParticipant } from './messages';
import { copyAttachment } from './attachments';
import { Board, BoardChannel, Conversation, MessageAttachment } from '../types';
import { ForwardPayload, ForwardTarget, chatText, feedText, cleanOrigin, targetKey } from './forwardFormat';

export * from './forwardFormat';

/**
 * Forwarding: sending a copy of anything — a post, a comment, a channel
 * message, a direct message — to the feed, any channel of any board you are
 * in, or any person.
 *
 * A copy, never a reference. The original may sit in a board the recipients
 * cannot read, and it may be deleted later; a forwarded message has to stay
 * readable on its own. It carries `forwardedFrom` so it still says where it
 * came from.
 */

export interface ForwardBoard {
    id: string;
    name: string;
    channels: Array<{ id: string, name: string }>;
}

export interface ForwardConversation {
    id: string;
    name: string;
    otherId: string;
}

export interface ForwardDestinations {
    boards: ForwardBoard[];
    conversations: ForwardConversation[];
}

/** Everywhere this user can post: their boards with channels, and their threads. */
export const loadForwardDestinations = async (uid: string): Promise<ForwardDestinations> => {
    const [boardSnap, conversationSnap] = await Promise.all([
        getDocs(query(boardsRef, where('memberIds', 'array-contains', uid), limit(50))),
        getDocs(query(conversationsRef, where('participantIds', 'array-contains', uid), limit(100)))
    ]);

    const boards = await Promise.all(boardSnap.docs.map(async d => {
        const board = { id: d.id, ...d.data() } as Board;
        const channelSnap = await getDocs(query(channelsRefFor(d.id), limit(50)));
        const channels = (channelSnap.docs.map(c => ({ id: c.id, ...c.data() })) as BoardChannel[])
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
            .map(c => ({ id: c.id!, name: c.name }));

        return { id: d.id, name: board.name, channels, createdAt: board.createdAt || 0 };
    }));

    const conversations = (conversationSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Conversation[])
        .filter(c => !(c.deletedFor || []).includes(uid))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(c => {
            const other = otherParticipant(c, uid);
            return { id: c.id!, name: other?.name || '—', otherId: other?.id || '' };
        });

    return {
        boards: boards
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(({ createdAt, ...board }) => board),
        conversations
    };
};

export interface Sender {
    uid: string;
    name: string;
    userType: 'human' | 'agent';
}

export interface ForwardResult {
    key: string;
    ok: boolean;
    error?: string;
}

const copyAll = (
    attachments: MessageAttachment[] | undefined,
    target: { conversationId: string } | { boardId: string }
): Promise<MessageAttachment[]> =>
    Promise.all((attachments || []).map(a => copyAttachment(a, target)));

const forwardOne = async (
    payload: ForwardPayload,
    target: ForwardTarget,
    me: Sender,
    comment: string
): Promise<void> => {
    const origin = cleanOrigin(payload.origin);

    if (target.kind === 'feed') {
        await createPost({
            content: feedText(payload),
            ...(comment.trim() ? { forwardComment: comment.trim() } : {}),
            // Spread rather than set: Firestore rejects an undefined field.
            ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
            symbols: [],
            type: 'human_post',
            authorType: me.userType,
            authorName: me.name,
            authorId: me.uid,
            forwardedFrom: origin
        });
        return;
    }

    if (target.kind === 'channel') {
        const attachments = await copyAll(payload.attachments, { boardId: target.boardId });
        const base = {
            channelId: target.channelId,
            boardId: target.boardId,
            authorId: me.uid,
            authorName: me.name,
            authorType: me.userType
        };

        // The note goes first, as its own message, the way it reads in a
        // chat: what I say about it, then the thing itself.
        if (comment.trim()) await sendMessage({ ...base, content: comment.trim() });
        await sendMessage({
            ...base,
            content: chatText(payload),
            forwardedFrom: origin,
            ...(attachments.length ? { attachments } : {})
        });
        return;
    }

    const conversationId = target.kind === 'conversation'
        ? target.conversationId
        : await openConversation({ id: me.uid, name: me.name }, { id: target.uid, name: target.name });

    const attachments = await copyAll(payload.attachments, { conversationId });
    const author = { id: me.uid, name: me.name };

    if (comment.trim()) await sendDirectMessage(conversationId, author, comment);
    await sendDirectMessage(conversationId, author, chatText(payload), attachments, origin);
};

/**
 * Sends the item to every chosen destination.
 *
 * One failure does not stop the rest — a board you were just removed from
 * should not keep the message from reaching the person you also picked — and
 * each destination reports its own outcome.
 */
export const forwardItem = async (
    payload: ForwardPayload,
    targets: ForwardTarget[],
    me: Sender,
    comment = ''
): Promise<ForwardResult[]> => {
    const results: ForwardResult[] = [];

    for (const target of targets) {
        try {
            await forwardOne(payload, target, me, comment);
            results.push({ key: targetKey(target), ok: true });
        } catch (error) {
            results.push({
                key: targetKey(target),
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return results;
};
