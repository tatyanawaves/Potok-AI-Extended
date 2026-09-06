import { describe, it, expect } from 'vitest';
import { mayAccessConversation, conversationOfKey, keyFor } from '../worker/src/files';

const A = 'QWnFDPg4ElP0deecnCfJot2ttyf1';
const B = '8g3YsNP5ogZveUzOLShpHyBnW1y2';
const conversation = `dm_${[A, B].sort().join('_')}`;

describe('mayAccessConversation', () => {
    it('admits both participants', () => {
        expect(mayAccessConversation(conversation, A)).toBe(true);
        expect(mayAccessConversation(conversation, B)).toBe(true);
    });

    it('refuses anyone else', () => {
        // The whole access check rests on this: a signed-in stranger holding a
        // valid token must not be able to read someone else's attachment.
        expect(mayAccessConversation(conversation, 'uid-stranger')).toBe(false);
    });

    it('refuses an id that is not a conversation', () => {
        expect(mayAccessConversation('boards/abc', A)).toBe(false);
        expect(mayAccessConversation('', A)).toBe(false);
    });
});

describe('conversationOfKey', () => {
    it('reads the conversation out of a key', () => {
        expect(conversationOfKey(`dm/${conversation}/abc-photo.png`)).toBe(conversation);
    });

    it('rejects a key outside the dm namespace', () => {
        // Without this a crafted key could point anywhere in the bucket.
        expect(conversationOfKey('other/thing/file.png')).toBeNull();
        expect(conversationOfKey('file.png')).toBeNull();
    });
});

describe('keyFor', () => {
    it('places the file under its conversation', () => {
        expect(keyFor(conversation, 'photo.png')).toMatch(
            new RegExp(`^dm/${conversation}/[0-9a-f-]{36}-photo\\.png$`)
        );
    });

    it('strips path separators out of the name', () => {
        // A name like "../../secret" must not be able to climb the key space.
        const key = keyFor(conversation, '../../escape.txt');
        expect(conversationOfKey(key)).toBe(conversation);
        expect(key).not.toContain('..');
    });

    it('keeps non-Latin names readable', () => {
        expect(keyFor(conversation, 'договор.pdf')).toContain('договор.pdf');
    });

    it('falls back to a placeholder when nothing usable is left', () => {
        expect(keyFor(conversation, '///')).toMatch(/-file$/);
    });
});
