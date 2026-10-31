import { describe, it, expect } from 'vitest';
import { feedKeyFor, feedOwnerOfKey, boardOfKey, conversationOfKey } from '../worker/src/files';

describe('files attached to feed posts', () => {
    it('live under their author and are told apart from board and DM files', () => {
        const key = feedKeyFor('uidA', 'отчёт Q3.pdf');
        expect(key).toMatch(/^feed\/uidA\/[0-9a-f-]{36}-/);
        expect(feedOwnerOfKey(key)).toBe('uidA');
        expect(boardOfKey(key)).toBeNull();
        expect(conversationOfKey(key)).toBeNull();
        expect(feedOwnerOfKey('board/b1/x-file')).toBeNull();
        expect(feedOwnerOfKey('feed/')).toBeNull();
    });
});
