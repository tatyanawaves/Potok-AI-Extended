import { AISettings, BoardMessage } from '../../types';
import { complete, embed } from '../llm';
import {
    ChannelSummary, EMPTY_SUMMARY, MemoryNote, compactionBatch, summaryPrompt, parseSummary,
    rankByRelevance, rankHybrid, selectWindow, needsEmbedding, packVector, clip, AUTO_NOTES
} from '../memoryCore';
import { AgentStore } from './store';

/**
 * Agent memory at run time: keeping the summary current, filing notes and
 * finding them. The rules are in ../memoryCore; storage is whatever AgentStore
 * the caller passes, so this runs in the browser and in the worker alike.
 */

/** Unsummarised messages read per turn at most. */
const HISTORY_FETCH = 40;
/** Notes given a vector per recall at most, so an old board catches up gradually. */
const BACKFILL_BATCH = 32;
/** After a failed embedding call, keyword search only for this long. */
const EMBEDDING_COOLDOWN_MS = 10 * 60_000;

const embeddingFailures = new Map<string, number>();
const embeddingKey = (s: AISettings) => `${s.apiBaseUrl || ''}|${s.embeddingModel || ''}`;

/** Whether semantic search should be attempted with these settings right now. */
export const semanticSearchOn = (settings: AISettings): boolean => {
    if (!settings.embeddingModel?.trim()) return false;
    const failedAt = embeddingFailures.get(embeddingKey(settings));
    return !failedAt || Date.now() - failedAt > EMBEDDING_COOLDOWN_MS;
};

const noteFailure = (settings: AISettings, error: unknown) => {
    embeddingFailures.set(embeddingKey(settings), Date.now());
    console.warn('[Memory] Semantic search off for now, keywords only:', error);
};

/** Files a note, with its vector when semantic search is on. */
export const fileNote = async (
    store: AgentStore,
    settings: AISettings,
    boardId: string,
    note: Omit<MemoryNote, 'id' | 'createdAt' | 'embedding' | 'embeddingModel'>
): Promise<void> => {
    const text = clip(note.text.trim(), 500);
    if (!text) return;

    // The same fact filed twice is noise in every later recall.
    const existing = await store.loadNotes(boardId);
    if (existing.some(n => n.text.trim().toLowerCase() === text.toLowerCase())) return;

    let vector: { embedding: string, embeddingModel: string } | {} = {};
    if (semanticSearchOn(settings)) {
        try {
            const [v] = await embed([text], settings);
            vector = { embedding: packVector(v), embeddingModel: settings.embeddingModel!.trim() };
        } catch (error) {
            noteFailure(settings, error);
        }
    }

    await store.addNote(boardId, { ...note, text, ...vector });
};

/**
 * Notes relevant to a request: by meaning and words when an embedding model
 * is set, by words alone otherwise or when the provider has no /embeddings.
 * Notes filed before semantic search was switched on get their vectors here,
 * a batch at a time.
 */
export const findNotes = async (
    store: AgentStore,
    settings: AISettings,
    boardId: string,
    query: string,
    limit = AUTO_NOTES
): Promise<MemoryNote[]> => {
    const notes = await store.loadNotes(boardId);
    if (!query.trim() || notes.length === 0) return [];
    if (!semanticSearchOn(settings)) return rankByRelevance(query, notes, n => n.text, limit);

    const model = settings.embeddingModel!.trim();
    try {
        const missing = needsEmbedding(notes, model).slice(0, BACKFILL_BATCH);
        const vectors = await embed([query, ...missing.map(n => n.text)], settings);
        const [queryVector, ...noteVectors] = vectors;

        await Promise.all(missing.map((note, i) => {
            note.embedding = packVector(noteVectors[i]);
            note.embeddingModel = model;
            return store.setNoteEmbedding(boardId, note.id!, note.embedding, model).catch(() => { });
        }));

        return rankHybrid(query, queryVector, notes, model, limit);
    } catch (error) {
        noteFailure(settings, error);
        return rankByRelevance(query, notes, n => n.text, limit);
    }
};

/**
 * Folds old messages into the running summary when enough have piled up.
 * Best effort: a failed compaction only means the next turn tries again.
 */
export const compactIfNeeded = async (
    store: AgentStore,
    settings: AISettings,
    boardId: string,
    channelId: string,
    history: BoardMessage[],
    summary: ChannelSummary
): Promise<ChannelSummary> => {
    const batch = compactionBatch(history, summary).slice(-30);
    if (batch.length === 0) return summary;

    const result = await complete({
        messages: [{ role: 'user', content: summaryPrompt(summary.text, batch) }],
        temperature: 0.2,
        maxTokens: 900,
        json: true,
        model: settings.memoryModel || undefined
    }, settings);

    const { summary: text, facts } = parseSummary(result.content, summary.text);
    const next: ChannelSummary = {
        text,
        coveredUntil: batch[batch.length - 1].timestamp,
        coveredCount: summary.coveredCount + batch.length,
        updatedAt: Date.now()
    };

    // Two writers may compact at once; only the first one's result is kept.
    if (!await store.replaceSummary(boardId, channelId, summary.coveredUntil, next)) {
        return store.getSummary(boardId, channelId);
    }

    for (const fact of facts) {
        await fileNote(store, settings, boardId, { text: fact, author: 'summary', channelId }).catch(() => { });
    }
    return next;
};

export interface TurnMemory {
    summary: ChannelSummary;
    notes: MemoryNote[];
    /** Recent messages sent verbatim. */
    window: BoardMessage[];
    /** The newest message in the channel, if any. */
    latest?: BoardMessage;
}

/**
 * Everything a bot sees of the past for one turn: the channel summary, the
 * notes most relevant to what it is asked, and the last few messages. Only
 * messages the summary does not cover are read.
 */
export const loadTurnMemory = async (
    store: AgentStore,
    settings: AISettings,
    boardId: string,
    channelId: string,
    focus?: string
): Promise<TurnMemory> => {
    let summary = await store.getSummary(boardId, channelId).catch(() => EMPTY_SUMMARY);
    const history = await store.getMessagesSince(boardId, channelId, summary.coveredUntil, HISTORY_FETCH);

    summary = await compactIfNeeded(store, settings, boardId, channelId, history, summary)
        .catch(error => {
            console.warn('[Memory] Compaction skipped:', error);
            return summary;
        });

    const latest = history[history.length - 1];
    const query = [focus, latest?.content].filter(Boolean).join(' ');
    const notes = await findNotes(store, settings, boardId, query).catch(() => []);

    const fresh = history.filter(m => (m.timestamp || 0) > summary.coveredUntil);
    return { summary, notes, window: selectWindow(fresh), latest };
};
