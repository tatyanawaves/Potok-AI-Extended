import { describe, it, expect } from 'vitest';
import {
    targetKey, chatText, feedText, cleanOrigin, describeOrigin, isEmptyPayload, ForwardPayload
} from '../services/forwardFormat';

const origin = { kind: 'board' as const, authorName: 'Neo', place: '#general · Team' };

describe('targetKey', () => {
    it('is distinct per destination', () => {
        const keys = [
            targetKey({ kind: 'feed' }),
            targetKey({ kind: 'channel', boardId: 'b', channelId: 'c', label: '#c' }),
            targetKey({ kind: 'channel', boardId: 'b', channelId: 'd', label: '#d' }),
            targetKey({ kind: 'conversation', conversationId: 'dm_1_2', label: 'x' }),
            targetKey({ kind: 'person', uid: '2', name: 'x' })
        ];
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('chatText', () => {
    it('carries a post image as a link, since a chat cannot show it', () => {
        expect(chatText({ text: 'look', imageUrl: 'https://img/1.png', origin })).toBe('look\nhttps://img/1.png');
    });

    it('is just the text otherwise', () => {
        expect(chatText({ text: '  hi  ', origin })).toBe('hi');
    });
});

describe('feedText', () => {
    const payload: ForwardPayload = {
        text: 'report',
        attachments: [{ key: 'k', name: 'q3.pdf', size: 1, contentType: 'application/pdf' }],
        origin
    };

    it('names files that cannot follow into the public feed', () => {
        expect(feedText(payload)).toBe('report\n\n📎 q3.pdf');
    });

    it('is just the text when there are no files', () => {
        expect(feedText({ text: ' report ', origin })).toBe('report');
    });
});

describe('cleanOrigin', () => {
    it('drops undefined and empty fields, which Firestore rejects', () => {
        expect(cleanOrigin({ kind: 'dm', authorName: 'Neo', authorId: undefined, place: '' }))
            .toEqual({ kind: 'dm', authorName: 'Neo' });
    });
});

describe('describeOrigin', () => {
    it('names the author and the place', () => {
        expect(describeOrigin(origin)).toBe('Переслано от Neo · #general · Team');
    });

    it('works without a place', () => {
        expect(describeOrigin({ kind: 'post', authorName: 'Ann' }, 'From')).toBe('From Ann');
    });
});

describe('isEmptyPayload', () => {
    it('treats an attachment or an image as content', () => {
        expect(isEmptyPayload({ text: ' ', origin })).toBe(true);
        expect(isEmptyPayload({ text: '', imageUrl: 'u', origin })).toBe(false);
        expect(isEmptyPayload({ text: '', attachments: [{ key: 'k', name: 'a', size: 1, contentType: '' }], origin })).toBe(false);
    });
});
