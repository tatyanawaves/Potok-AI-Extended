import {
    collection, doc, getDoc, getDocs, addDoc, deleteDoc, query, orderBy, limit, runTransaction, onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';
import { getMessagesSince } from './boards';
import { complete } from './llm';
import { AISettings, BoardMessage } from '../types';
import {
    ChannelSummary, EMPTY_SUMMARY, MemoryNote, compactionBatch, summaryPrompt, parseSummary,
    rankByRelevance, selectWindow, AUTO_NOTES, clip
} from './memoryCore';

/**
 * Agent memory: where it is stored and how it is kept up to date.
 * The rules — what to keep, when to compact, what to show — are in ./memoryCore.
 *
 *   boards/{boardId}/channels/{channelId}/memory/summary   running summary
 *   boards/{boardId}/notes/{noteId}                        durable notes
 *
 * Both live under the board, so the board's own security rules decide who
 * can read a bot's memory: its members, and nobody else.
 */

const summaryRef = (boardId: string, channelId: string) =>
    doc(db, 'boards', boardId, 'channels', channelId, 'memory', 'summary');

const notesRef = (boardId: string) => collection(db, 'boards', boardId, 'notes');

export const getSummary = async (boardId: string, channelId: string): Promise<ChannelSummary> => {
    const snap = await getDoc(summaryRef(boardId, channelId));
    return snap.exists() ? { ...EMPTY_SUMMARY, ...(snap.data() as ChannelSummary) } : EMPTY_SUMMARY;
};

export const subscribeToSummary = (
    boardId: string,
    channelId: string,
    callback: (summary: ChannelSummary) => void
) => onSnapshot(summaryRef(boardId, channelId),
    snap => callback(snap.exists() ? { ...EMPTY_SUMMARY, ...(snap.data() as ChannelSummary) } : EMPTY_SUMMARY),
    () => callback(EMPTY_SUMMARY));

// Notes are read on every bot turn; a meeting takes several turns in a row,
// so they are cached briefly rather than fetched each time.
const NOTES_TTL_MS = 30_000;
const notesCache = new Map<string, { at: number, notes: MemoryNote[] }>();

export const loadNotes = async (boardId: string, fresh = false): Promise<MemoryNote[]> => {
    const cached = notesCache.get(boardId);
    if (!fresh && cached && Date.now() - cached.at < NOTES_TTL_MS) return cached.notes;

    const snap = await getDocs(query(notesRef(boardId), orderBy('createdAt', 'desc'), limit(300)));
    const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }) as MemoryNote);
    notesCache.set(boardId, { at: Date.now(), notes });
    return notes;
};

export const subscribeToNotes = (boardId: string, callback: (notes: MemoryNote[]) => void) =>
    onSnapshot(query(notesRef(boardId), orderBy('createdAt', 'desc'), limit(300)), snap => {
        const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }) as MemoryNote);
        notesCache.set(boardId, { at: Date.now(), notes });
        callback(notes);
    }, () => callback([]));

export const addNote = async (boardId: string, note: Omit<MemoryNote, 'id' | 'createdAt'>): Promise<void> => {
    const text = clip(note.text.trim(), 500);
    if (!text) return;

    // The same fact filed twice is noise in every later recall.
    const existing = await loadNotes(boardId);
    if (existing.some(n => n.text.trim().toLowerCase() === text.toLowerCase())) return;

    await addDoc(notesRef(boardId), {
        text,
        author: note.author,
        ...(note.channelId ? { channelId: note.channelId } : {}),
        createdAt: Date.now()
    });
    notesCache.delete(boardId);
};

export const deleteNote = async (boardId: string, noteId: string): Promise<void> => {
    await deleteDoc(doc(db, 'boards', boardId, 'notes', noteId));
    notesCache.delete(boardId);
};

/** Forgets the channel's summary; the messages themselves stay. */
export const resetSummary = async (boardId: string, channelId: string): Promise<void> => {
    await deleteDoc(summaryRef(boardId, channelId));
};

export const recallNotes = async (boardId: string, queryText: string, max = 5): Promise<MemoryNote[]> =>
    rankByRelevance(queryText, await loadNotes(boardId), n => n.text, max);

/**
 * Folds old messages into the running summary when enough have piled up.
 *
 * Two browsers may reach the same point at once — both mentioned a bot in the
 * same minute. The write is a transaction that only goes through if the
 * summary still covers what it did when this one started; otherwise the
 * other writer already did the work and this result is dropped.
 *
 * Best effort: a failed compaction only means the next turn tries again.
 */
export const compactIfNeeded = async (
    boardId: string,
    channelId: string,
    history: BoardMessage[],
    settings: AISettings,
    current?: ChannelSummary
): Promise<ChannelSummary> => {
    const summary = current || await getSummary(boardId, channelId);
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

    const written = await runTransaction(db, async tx => {
        const snap = await tx.get(summaryRef(boardId, channelId));
        const stored = snap.exists() ? (snap.data() as ChannelSummary).coveredUntil : 0;
        if (stored !== summary.coveredUntil) return false;
        tx.set(summaryRef(boardId, channelId), next);
        return true;
    });

    if (!written) return getSummary(boardId, channelId);

    for (const fact of facts) {
        await addNote(boardId, { text: fact, author: 'summary', channelId }).catch(() => { });
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

/** Unsummarised messages read per turn at most. */
const HISTORY_FETCH = 40;

/**
 * Everything a bot sees of the past for one turn: the channel summary, the
 * notes most relevant to what it is being asked, and the last few messages.
 *
 * Only messages the summary does not cover are read from Firestore, so a turn
 * reads a handful of documents in a channel of any length.
 */
export const loadTurnMemory = async (
    boardId: string,
    channelId: string,
    settings: AISettings,
    focus?: string
): Promise<TurnMemory> => {
    let summary = await getSummary(boardId, channelId).catch(() => EMPTY_SUMMARY);
    const history = await getMessagesSince(boardId, channelId, summary.coveredUntil, HISTORY_FETCH);

    summary = await compactIfNeeded(boardId, channelId, history, settings, summary)
        .catch(error => {
            console.warn('[Memory] Compaction skipped:', error);
            return summary;
        });

    const latest = history[history.length - 1];
    const focusText = [focus, latest?.content].filter(Boolean).join(' ');
    const notes = await loadNotes(boardId)
        .then(all => rankByRelevance(focusText, all, n => n.text, AUTO_NOTES))
        .catch(() => []);

    // Messages just folded into the summary are not sent again.
    const fresh = history.filter(m => (m.timestamp || 0) > summary.coveredUntil);
    return { summary, notes, window: selectWindow(fresh), latest };
};
