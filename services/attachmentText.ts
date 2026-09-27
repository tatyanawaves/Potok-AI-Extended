/**
 * What bots see of a board attachment. The file itself sits in R2 behind the
 * worker, where a bot's turn cannot reach it, so the start of a small text
 * file is kept on the message at upload time.
 */

export const MAX_READABLE_BYTES = 64 * 1024;
export const MAX_KEPT_CHARS = 8000;
const FOR_BOTS_CHARS = 4000;

const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|jsonl|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|sh|sql|log|ini|toml|env\.example|c|h|cpp|java|kt|go|rs|rb|php)$/i;

/** Files read in full when a bot needs one kept without its text (uploaded before, or too big to keep). */
export const MAX_FETCHED_BYTES = 10 * 1024 * 1024;

export const isReadableText = (file: { name: string; type: string; size: number }, maxBytes = MAX_READABLE_BYTES): boolean =>
    file.size <= maxBytes
    && (file.type.startsWith('text/') || /json|xml|yaml|javascript|csv/.test(file.type) || TEXT_EXTENSIONS.test(file.name));

export const keptText = (text: string): string =>
    text.length > MAX_KEPT_CHARS ? `${text.slice(0, MAX_KEPT_CHARS)}\n…(обрезано)` : text;

export const attachmentsForBots = (attachments: { name: string; size: number; text?: string }[] | undefined): string => {
    if (!attachments?.length) return '';
    return attachments.map(a => {
        const head = `[вложение: ${a.name}, ${a.size} байт]`;
        if (a.text === undefined) return `${head} (содержимое недоступно боту)`;
        const body = a.text.length > FOR_BOTS_CHARS ? `${a.text.slice(0, FOR_BOTS_CHARS)}\n…(обрезано)` : a.text;
        return `${head}\n\`\`\`\n${body}\n\`\`\``;
    }).join('\n');
};

type Readable = { key: string; name: string; size: number; contentType: string; text?: string };

/**
 * Fills in the text of attachments that were stored without it, so a bot sees
 * files uploaded before text was kept, and larger ones. Messages are changed
 * in place; a file that cannot be read stays as it was.
 */
export const hydrateAttachments = async (
    messages: { attachments?: Readable[] }[],
    read: ((key: string) => Promise<string>) | undefined
): Promise<void> => {
    if (!read) return;
    const missing = messages.flatMap(m => m.attachments || [])
        .filter(a => a.text === undefined && isReadableText({ name: a.name, type: a.contentType, size: a.size }, MAX_FETCHED_BYTES));
    await Promise.all(missing.map(async a => {
        const text = await read(a.key).catch(() => undefined);
        if (text !== undefined) a.text = keptText(text);
    }));
};
