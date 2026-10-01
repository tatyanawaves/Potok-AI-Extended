import { describe, it, expect, vi } from 'vitest';
import { isReadableText, keptText, attachmentsForBots, hydrateAttachments, MAX_KEPT_CHARS, MAX_READABLE_BYTES } from '../services/attachmentText';
import { textForBots } from '../services/terminal';

describe('isReadableText', () => {
    it('accepts small text files by type or extension', () => {
        expect(isReadableText({ name: 'a.csv', type: 'text/csv', size: 20 })).toBe(true);
        expect(isReadableText({ name: 'main.py', type: '', size: 20 })).toBe(true);
        expect(isReadableText({ name: 'data.json', type: 'application/json', size: 20 })).toBe(true);
    });

    it('refuses binaries and big files', () => {
        expect(isReadableText({ name: 'a.png', type: 'image/png', size: 20 })).toBe(false);
        expect(isReadableText({ name: 'a.csv', type: 'text/csv', size: MAX_READABLE_BYTES + 1 })).toBe(false);
    });
});

describe('attachmentsForBots', () => {
    it('shows a text file with its contents', () => {
        const out = attachmentsForBots([{ name: 't.csv', size: 12, text: 'name,score\nА,3' }]);
        expect(out).toContain('[вложение: t.csv, 12 байт]');
        expect(out).toContain('name,score\nА,3');
    });

    it('names a file without text', () => {
        expect(attachmentsForBots([{ name: 'p.png', size: 5 }])).toBe('[вложение: p.png, 5 байт] (содержимое недоступно боту)');
        expect(attachmentsForBots([{ key: 'board/b/x-p.png', name: 'p.png', size: 5 }])).toBe('[вложение: p.png, 5 байт, key=board/b/x-p.png] (содержимое недоступно боту)');
    });

    it('keeps at most MAX_KEPT_CHARS', () => {
        expect(keptText('x'.repeat(MAX_KEPT_CHARS + 10)).startsWith('x'.repeat(MAX_KEPT_CHARS) + '\n…')).toBe(true);
    });

    it('goes into what bots read of a message', () => {
        const text = textForBots({ content: '@Кодер среднее?', attachments: [{ key: 'k', name: 't.csv', size: 12, contentType: 'text/csv', text: 'a,1' }] });
        expect(text.startsWith('@Кодер среднее?\n[вложение: t.csv')).toBe(true);
        expect(text).toContain('a,1');
    });
});

describe('hydrateAttachments', () => {
    type File = { key: string; name: string; size: number; contentType: string; text?: string };
    const csv = (text?: string): File => ({ key: 'board/b/1-a.csv', name: 'a.csv', size: 200_000, contentType: 'text/csv', ...(text !== undefined ? { text } : {}) });

    it('reads text files stored without text, even large ones', async () => {
        const messages = [{ attachments: [csv()] }];
        await hydrateAttachments(messages, async key => `read ${key}`);
        expect(messages[0].attachments[0].text).toBe('read board/b/1-a.csv');
    });

    it('leaves kept text, binaries and failed reads alone', async () => {
        const png: File = { key: 'k2', name: 'p.png', size: 5, contentType: 'image/png' };
        const messages = [{ attachments: [csv('kept'), png] }, { attachments: [{ ...csv(), key: 'bad' }] }];
        const read = vi.fn(async (key: string) => { if (key === 'bad') throw new Error('403'); return 'x'; });
        await hydrateAttachments(messages, read);
        expect(read).toHaveBeenCalledTimes(1);
        expect(messages[0].attachments[0].text).toBe('kept');
        expect('text' in messages[0].attachments[1]).toBe(false);
        expect('text' in messages[1].attachments[0]).toBe(false);
    });

    it('does nothing without a reader', async () => {
        const messages = [{ attachments: [csv()] }];
        await hydrateAttachments(messages, undefined);
        expect('text' in messages[0].attachments[0]).toBe(false);
    });
});
