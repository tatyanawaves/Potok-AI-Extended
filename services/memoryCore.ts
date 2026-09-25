import { BoardMessage } from '../types';
import { textForBots } from './terminal';

/**
 * Agent memory: the pure part.
 *
 * The problem it solves: every bot turn used to send the last 20 channel
 * messages in full. In a meeting that is 20 messages × every turn × every
 * tool round, and the context still forgot anything older than 20 messages.
 *
 * Three tiers, cheapest first, the way long-running assistants keep context:
 *
 *  1. Working window — only the last few messages go in verbatim, each capped,
 *     the whole window capped by an estimated token budget.
 *  2. Rolling summary — everything older than the window is folded, a batch at
 *     a time, into one running summary per channel (recursive summarisation).
 *     It stays about the same size however long the channel gets.
 *  3. Notes — durable facts, decisions and results, kept per board and found by
 *     relevance to the current request. Bots write them with a `remember` tool
 *     and look them up with `recall`; the summariser also files the facts it
 *     comes across. Only the few most relevant notes are shown to a bot.
 *
 * The fixed part of the prompt (persona, then memory) comes first and the
 * changing part last, so providers that cache prompt prefixes can reuse it.
 */

/** Raw messages sent verbatim on every turn. */
export const WINDOW_MESSAGES = 6;
/** Budget for those messages together, in estimated tokens. */
export const WINDOW_TOKEN_BUDGET = 1500;
/** Longest single message kept in the window, in characters. */
export const MAX_MESSAGE_CHARS = 900;
/** The same for a message with a terminal: its output is what a bot is asked about. */
export const MAX_TERMINAL_MESSAGE_CHARS = 1600;
/** Unsummarised messages beyond the window that trigger a compaction. */
export const COMPACT_BATCH = 8;
/** The running summary is kept under this many characters. */
export const MAX_SUMMARY_CHARS = 1600;
/** Notes shown to a bot without it asking. */
export const AUTO_NOTES = 3;

export interface ChannelSummary {
    text: string;
    /** Timestamp of the newest message folded into the summary. */
    coveredUntil: number;
    /** How many messages the summary covers in total. */
    coveredCount: number;
    updatedAt: number;
}

export const EMPTY_SUMMARY: ChannelSummary = { text: '', coveredUntil: 0, coveredCount: 0, updatedAt: 0 };

export interface MemoryNote {
    id?: string;
    text: string;
    /** Who filed it: a bot's name, or "summary" for facts the summariser found. */
    author: string;
    channelId?: string;
    createdAt: number;
    /** The note's embedding, packed by packVector; see rankHybrid. */
    embedding?: string;
    /** Which model made it — vectors of different models do not compare. */
    embeddingModel?: string;
}

/**
 * A rough token count: about four characters per token for English, closer
 * to three for Cyrillic. Only used to keep context under a budget, where
 * erring on the high side is the safe direction.
 */
export const estimateTokens = (text: string): number => {
    if (!text) return 0;
    const cyrillic = (text.match(/[Ѐ-ӿ]/g) || []).length;
    const ratio = cyrillic > text.length / 3 ? 3 : 4;
    return Math.ceil(text.length / ratio);
};

export const clip = (text: string, max: number): string =>
    text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Messages newer than what the summary already covers, oldest first. */
export const unsummarised = (history: BoardMessage[], summary: ChannelSummary): BoardMessage[] =>
    history.filter(m => (m.timestamp || 0) > summary.coveredUntil && !m.isPending);

/**
 * The last messages that fit the window: at most WINDOW_MESSAGES, each clipped,
 * dropping the oldest until the total fits the token budget. The newest message
 * is always kept — it is usually the one being answered.
 */
export const selectWindow = (
    history: BoardMessage[],
    maxMessages = WINDOW_MESSAGES,
    tokenBudget = WINDOW_TOKEN_BUDGET
): BoardMessage[] => {
    const recent = history.filter(m => !m.isPending).slice(-maxMessages)
        .map(m => ({
            ...m,
            content: clip(textForBots(m), m.terminal?.length ? MAX_TERMINAL_MESSAGE_CHARS : MAX_MESSAGE_CHARS)
        }));

    let total = recent.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    while (recent.length > 1 && total > tokenBudget) {
        total -= estimateTokens(recent.shift()!.content);
    }
    return recent;
};

/**
 * Which messages to fold into the summary now, if any.
 *
 * Compaction runs in batches rather than per message: one summarising call per
 * COMPACT_BATCH messages is the whole overhead of keeping memory, instead of
 * re-sending those messages on every later turn.
 */
export const compactionBatch = (
    history: BoardMessage[],
    summary: ChannelSummary,
    windowSize = WINDOW_MESSAGES,
    batch = COMPACT_BATCH
): BoardMessage[] => {
    const pending = unsummarised(history, summary);
    const foldable = pending.slice(0, Math.max(0, pending.length - windowSize));
    return foldable.length >= batch ? foldable : [];
};

export const renderTranscript = (messages: BoardMessage[]): string =>
    messages.map(m => `${m.authorName}: ${clip(textForBots(m).replace(/\s+/g, ' '), 600)}`).join('\n');

/** The prompt that folds a batch of messages into the running summary. */
export const summaryPrompt = (previous: string, batch: BoardMessage[]): string => `MEMORY_SUMMARY
You maintain the long-term memory of a team chat between people and AI bots.
Update the running summary with the new messages. Keep: decisions, agreed facts,
numbers, names, open tasks and who owns them, results of tool calls, questions
still unanswered. Drop greetings and repetition. Write in the language of the chat.
Keep the summary under ${Math.round(MAX_SUMMARY_CHARS / 1.2)} characters; merge and shorten older points to make room.
Also list up to 3 durable facts worth remembering beyond this chat (or none).

CURRENT SUMMARY:
${previous || '(empty)'}

NEW MESSAGES:
${renderTranscript(batch)}

Respond ONLY in JSON: {"summary": "...", "facts": ["..."]}`;

/** Reads the summariser's answer; falls back to the raw text as the summary. */
export const parseSummary = (raw: string | null, previous: string): { summary: string, facts: string[] } => {
    const text = (raw || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            const data = JSON.parse(match[0]);
            const summary = typeof data.summary === 'string' && data.summary.trim()
                ? data.summary.trim()
                : previous;
            const facts = Array.isArray(data.facts)
                ? data.facts.filter((f: unknown) => typeof f === 'string' && f.trim()).map((f: string) => f.trim()).slice(0, 3)
                : [];
            return { summary: clip(summary, MAX_SUMMARY_CHARS), facts };
        } catch {
            // fall through to plain text
        }
    }
    return { summary: clip(text || previous, MAX_SUMMARY_CHARS), facts: [] };
};

// --- Retrieval ----------------------------------------------------------------

const STOP_WORDS = new Set([
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но',
    'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще',
    'нет', 'о', 'из', 'ему', 'это', 'для', 'мы', 'их', 'или', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in',
    'is', 'are', 'for', 'on', 'with', 'it', 'this', 'that', 'be', 'as', 'at', 'by', 'from'
]);

const RU_ENDING = /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ах|ях|ов|ев|ей|ой|ом|ем|ам|ям|ую|юю|ая|яя|ое|ее|ые|ие|ый|ий|а|я|о|е|ы|и|у|ю|ь|й)$/;
const EN_ENDING = /(ing|ed|es|s)$/;

/**
 * Words reduced to a light stem: one inflectional ending removed and the rest
 * cut to seven letters. Enough to match word forms ("отчёт", "отчёта",
 * "отчётом"; "report", "reports") without a morphology library in the bundle.
 */
export const stem = (word: string): string => {
    const ending = /[а-я]/.test(word) ? RU_ENDING : EN_ENDING;
    const stripped = word.length > 4 ? word.replace(ending, '') : word;
    return (stripped.length >= 3 ? stripped : word).slice(0, 7);
};

export const terms = (text: string): string[] =>
    (text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [])
        .filter(w => w.length > 1 && !STOP_WORDS.has(w))
        .map(stem);

/**
 * Ranks documents by relevance to a query: BM25, the standard lexical ranking,
 * over the crude stems above. Embeddings would match meaning rather than
 * words, but they need a second API and a vector store; for a few hundred
 * short notes per board this is fast, free and good enough.
 */
export const rankByRelevance = <T>(
    query: string,
    docs: T[],
    textOf: (doc: T) => string,
    limit = AUTO_NOTES
): T[] => {
    const q = [...new Set(terms(query))];
    if (q.length === 0 || docs.length === 0) return [];

    const docTerms = docs.map(d => terms(textOf(d)));
    const avgLen = docTerms.reduce((s, t) => s + t.length, 0) / docTerms.length || 1;
    const df = new Map<string, number>();
    docTerms.forEach(t => new Set(t).forEach(term => df.set(term, (df.get(term) || 0) + 1)));

    const k1 = 1.2, b = 0.75, n = docs.length;
    const scored = docs.map((doc, i) => {
        const tf = new Map<string, number>();
        docTerms[i].forEach(term => tf.set(term, (tf.get(term) || 0) + 1));
        let score = 0;
        for (const term of q) {
            const f = tf.get(term) || 0;
            if (!f) continue;
            const idf = Math.log(1 + (n - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docTerms[i].length / avgLen));
        }
        return { doc, score };
    });

    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.doc);
};

/**
 * The memory block placed after the persona in a bot's system prompt.
 * Empty when there is nothing to remember, so a new channel costs nothing.
 */
export const memoryBlock = (summary: ChannelSummary, notes: MemoryNote[]): string => {
    const parts: string[] = [];
    if (summary.text) parts.push(`EARLIER IN THIS CHANNEL (summary of ${summary.coveredCount} older messages):\n${summary.text}`);
    if (notes.length) parts.push(`RELEVANT NOTES FROM MEMORY:\n${notes.map(n => `- ${n.text}`).join('\n')}`);
    return parts.join('\n\n');
};

// --- Tool selection -------------------------------------------------------------

/** Tools offered to the model per request at most. */
export const MAX_OFFERED_TOOLS = 12;

/**
 * Picks the tools worth offering for a request.
 *
 * Every tool definition is sent with every request, and connected services
 * often expose dozens — a Pipedream app alone can bring forty, several
 * thousand tokens of schema per request, most of it irrelevant. Past the cap,
 * the tools whose name and description best match the request are kept.
 *
 * Tool descriptions are mostly English and requests often are not, so the
 * match can come up nearly empty. The free slots are then shared between the
 * tools' groups (`groupOf`, e.g. the server they come from) in turn — filled
 * in list order, a bot with three servers only ever saw the first one.
 */
export const selectTools = <T extends { name: string, description?: string }>(
    tools: T[],
    query: string,
    max = MAX_OFFERED_TOOLS,
    groupOf?: (tool: T) => string
): T[] => {
    if (tools.length <= max) return tools;
    const ranked = rankByRelevance(query, tools, t => `${t.name.replace(/[_-]/g, ' ')} ${t.description || ''}`, max);
    const rest = tools.filter(t => !ranked.includes(t));
    return [...ranked, ...(groupOf ? interleave(rest, groupOf) : rest)].slice(0, max);
};

/** Round-robin over groups, keeping the order within each group. */
export const interleave = <T>(items: T[], groupOf: (item: T) => string): T[] => {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const key = groupOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
    }
    const queues = [...groups.values()];
    const out: T[] = [];
    for (let i = 0; out.length < items.length; i++) {
        for (const queue of queues) if (i < queue.length) out.push(queue[i]);
    }
    return out;
};

// --- Semantic retrieval -----------------------------------------------------------

/**
 * Vectors are stored as base64 of Float32: a quarter of the size of a JSON
 * array of numbers, and a single string field in Firestore.
 */
export const packVector = (vector: number[]): string => {
    const bytes = new Uint8Array(new Float32Array(vector).buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

export const unpackVector = (packed: string): number[] => {
    const binary = atob(packed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return Array.from(new Float32Array(bytes.buffer));
};

export const cosine = (a: number[], b: number[]): number => {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * Below this similarity a note is not shown on meaning alone. Unrelated texts
 * score roughly 0.05–0.2 with common embedding models, related ones 0.35+.
 */
export const MIN_SIMILARITY = 0.3;

/**
 * Ranks notes by meaning and by words together.
 *
 * Embeddings find "ad spend" for "рекламный бюджет"; keywords find exact
 * names, numbers and ids that embeddings blur. The two rankings are merged by
 * reciprocal rank fusion — the standard way to combine rankings whose scores
 * are on different scales. A note must pass one of the two on its own merits,
 * so an unrelated board does not fill the prompt with its nearest neighbours.
 * Notes without a vector from the same model still compete on keywords.
 */
export const rankHybrid = (
    query: string,
    queryVector: number[],
    notes: MemoryNote[],
    model: string,
    limit = AUTO_NOTES
): MemoryNote[] => {
    const K = 60;
    const lexical = rankByRelevance(query, notes, n => n.text, notes.length);
    const semantic = notes
        .filter(n => n.embedding && n.embeddingModel === model)
        .map(n => ({ note: n, score: cosine(queryVector, unpackVector(n.embedding!)) }))
        .filter(s => s.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score);

    const fused = new Map<MemoryNote, number>();
    lexical.forEach((n, i) => fused.set(n, (fused.get(n) || 0) + 1 / (K + i + 1)));
    semantic.forEach((s, i) => fused.set(s.note, (fused.get(s.note) || 0) + 1 / (K + i + 1)));

    return [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n);
};

/** Notes whose vector is missing or from another model. */
export const needsEmbedding = (notes: MemoryNote[], model: string): MemoryNote[] =>
    notes.filter(n => n.id && (!n.embedding || n.embeddingModel !== model));
