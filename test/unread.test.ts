import { describe, it, expect } from 'vitest';
import {
    isConversationUnread, isChannelUnread, isBoardUnread, EMPTY_READ_STATE
} from '../services/unread';
import { Board, BoardChannel, Conversation, ReadState } from '../types';

const ME = 'uid-me';
const THEM = 'uid-them';

const state = (over: Partial<ReadState> = {}): ReadState => ({ ...EMPTY_READ_STATE, ...over });

const conversation = (last?: { authorId: string, timestamp: number }): Conversation => ({
    id: 'dm_a_b',
    participants: [],
    participantIds: [ME, THEM],
    createdAt: 0,
    updatedAt: 0,
    ...(last ? { lastMessage: { content: 'hi', ...last } } : {})
});

const channel = (over: Partial<BoardChannel> = {}): BoardChannel => ({
    id: 'ch1', boardId: 'b1', name: 'general', createdAt: 0, ...over
});

const board = (over: Partial<Board> = {}): Board => ({
    id: 'b1', name: 'Board', ownerId: ME, members: [], memberIds: [ME], createdAt: 0, ...over
});

describe('isConversationUnread', () => {
    it('marks a message that arrived after the last look', () => {
        expect(isConversationUnread(
            conversation({ authorId: THEM, timestamp: 200 }),
            state({ conversations: { dm_a_b: 100 } }), ME
        )).toBe(true);
    });

    it('stays quiet once the thread has been opened', () => {
        expect(isConversationUnread(
            conversation({ authorId: THEM, timestamp: 100 }),
            state({ conversations: { dm_a_b: 200 } }), ME
        )).toBe(false);
    });

    it('never badges your own message', () => {
        // Your message is always newer than the mark you held when you sent it,
        // so without this every send would light up its own thread.
        expect(isConversationUnread(
            conversation({ authorId: ME, timestamp: 999 }), state(), ME
        )).toBe(false);
    });

    it('treats a never-opened thread with a message as unread', () => {
        expect(isConversationUnread(
            conversation({ authorId: THEM, timestamp: 1 }), state(), ME
        )).toBe(true);
    });

    it('says nothing about an empty thread', () => {
        expect(isConversationUnread(conversation(), state(), ME)).toBe(false);
    });
});

describe('isChannelUnread', () => {
    it('marks a message newer than the last visit', () => {
        expect(isChannelUnread(
            channel({ lastMessageAt: 200, lastMessageAuthorId: THEM }),
            state({ channels: { ch1: 100 } }), ME
        )).toBe(true);
    });

    it('ignores what you wrote yourself', () => {
        expect(isChannelUnread(
            channel({ lastMessageAt: 200, lastMessageAuthorId: ME }), state(), ME
        )).toBe(false);
    });

    it('counts a bot reply as unread', () => {
        // A bot answers under its own generated id, never the mentioner's, so
        // its reply must reach the person who asked for it.
        expect(isChannelUnread(
            channel({ lastMessageAt: 200, lastMessageAuthorId: 'bot-generated-id' }), state(), ME
        )).toBe(true);
    });

    it('says nothing about a channel that was never written in', () => {
        expect(isChannelUnread(channel(), state(), ME)).toBe(false);
    });
});

describe('isBoardUnread', () => {
    it('marks activity since the board was last opened', () => {
        expect(isBoardUnread(
            board({ lastMessageAt: 300, lastMessageAuthorId: THEM }),
            state({ boards: { b1: 200 } }), ME
        )).toBe(true);
    });

    it('clears once the board has been visited', () => {
        expect(isBoardUnread(
            board({ lastMessageAt: 300, lastMessageAuthorId: THEM }),
            state({ boards: { b1: 400 } }), ME
        )).toBe(false);
    });

    it('survives a read state that has never been written', () => {
        // A first-time user has no document at all; the dots must still render
        // rather than throwing on a missing map.
        expect(() => isBoardUnread(board({ lastMessageAt: 1 }), {} as ReadState, ME)).not.toThrow();
    });
});
