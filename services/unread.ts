import { Board, BoardChannel, Conversation, ReadState } from '../types';

/**
 * Which places still hold something you have not seen.
 *
 * Pure on purpose: ./reads opens the Firestore connection at import time, so
 * these rules would be untestable if they lived there. Imported back into
 * ./reads and re-exported, so callers need only one module.
 */

export const EMPTY_READ_STATE: ReadState = { channels: {}, conversations: {}, boards: {} };

/**
 * A thread is unread when its last message is newer than your mark.
 *
 * Your own message never counts: it arrives with a timestamp later than the
 * mark you had, and a badge for something you just wrote yourself is noise.
 */
export const isConversationUnread = (
    conversation: Conversation,
    state: ReadState,
    uid: string
): boolean => {
    const last = conversation.lastMessage;
    if (!last || last.authorId === uid) return false;

    return last.timestamp > (state.conversations?.[conversation.id || ''] || 0);
};

/**
 * A channel is unread when it holds a message newer than your mark.
 *
 * Unlike a conversation there is no cheap way to know who wrote last without
 * reading the messages, so `lastMessageAuthorId` is denormalized onto the
 * channel for exactly this check.
 */
export const isChannelUnread = (
    channel: BoardChannel,
    state: ReadState,
    uid: string
): boolean => {
    if (!channel.lastMessageAt) return false;
    if (channel.lastMessageAuthorId === uid) return false;

    return channel.lastMessageAt > (state.channels?.[channel.id || ''] || 0);
};

/**
 * A board is unread when anything was written in it since you last looked.
 *
 * Deliberately coarser than the per-channel dot: only the open board's
 * channels are loaded, so a board you are not looking at can be judged solely
 * by what its own document says. It answers "someone wrote here", not "which
 * channel" — and the channel dots answer that once the board is open.
 */
export const isBoardUnread = (board: Board, state: ReadState, uid: string): boolean => {
    if (!board.lastMessageAt) return false;
    if (board.lastMessageAuthorId === uid) return false;

    return board.lastMessageAt > (state.boards?.[board.id || ''] || 0);
};
