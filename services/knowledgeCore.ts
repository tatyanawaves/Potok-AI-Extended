import { MemoryNote } from './memoryCore';
import { untrusted } from './untrusted';

/**
 * The board's knowledge base: documents members upload, cut into passages
 * that bots find by meaning and words (rankHybrid, as for notes) and quote
 * with a citation. Pure; storage is in ./knowledge and the AgentStores.
 *
 * Passages are data, never instructions: a document can say anything.
 */

/** Characters per passage, and how much of the previous one it repeats. */
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 150;
/** Passages per board at most, so a turn can load them all. */
export const MAX_BOARD_CHUNKS = 400;
/** Passages shown to a bot per turn without it asking. */
export const AUTO_PASSAGES = 4;

/**
 * A passage of a document. Shaped as a note (text, author = the document's
 * title, embedding) so the notes' ranking applies unchanged.
 */
export interface KnowledgeChunk extends MemoryNote {
    docId: string;
    title: string;
    /** Its place in the document, from 1; cited as §index. */
    index: number;
}

export interface KnowledgeDoc {
    id: string;
    title: string;
    chunks: number;
    chars: number;
    addedBy: string;
    addedByName: string;
    createdAt: number;
}

/**
 * Cuts text into passages of about `size` characters at paragraph, then
 * sentence, then word boundaries; each repeats the tail of the one before,
 * so a fact split across a boundary is still whole in one of them.
 */
export const chunkText = (raw: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] => {
    const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return [];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            const window = text.slice(start, end);
            const floor = Math.floor(size * 0.5);
            const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf(' ')]
                .find(i => i >= floor);
            if (cut !== undefined) end = start + cut + 1;
        }
        const piece = text.slice(start, end).trim();
        if (piece) chunks.push(piece);
        if (end >= text.length) break;
        // Back up for the overlap, to a word start.
        let next = Math.max(end - overlap, start + 1);
        const space = text.indexOf(' ', next);
        if (space !== -1 && space < end) next = space + 1;
        start = next;
    }
    return chunks;
};

/** "[Регламент §3]" */
export const citationOf = (chunk: Pick<KnowledgeChunk, 'title' | 'index'>): string => `[${chunk.title} §${chunk.index}]`;

/** Passages for the bot's context, each in an <untrusted> block with its citation. */
export const knowledgeBlock = (chunks: KnowledgeChunk[]): string =>
    chunks.map(c => untrusted(`board knowledge base ${citationOf(c)}`, c.text)).join('\n');

/** Said to the bot when passages are in its context. */
export const CITE_RULE = 'Passages from the board knowledge base are in your context, each labelled like [Title §n]. When your answer relies on one, cite it with that label. If they do not cover the question, say so rather than guess.';

/** A document title: the file name without its extension, tidied. */
export const titleOf = (fileName: string): string =>
    fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[[\]]/g, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'Документ';
