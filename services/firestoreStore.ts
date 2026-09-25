import {
    collection, doc, getDoc, getDocs, addDoc, updateDoc, query, orderBy, limit, runTransaction
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { getMessagesSince, sendMessage } from './boards';
import { AISettings } from '../types';
import { ChannelSummary, EMPTY_SUMMARY, MemoryNote } from './memoryCore';
import { AgentStore } from './runtime/store';

/**
 * The agent runtime's storage in the browser: the Firestore web SDK, signed
 * in as the user. See ./runtime/store for why this is an interface.
 *
 *   boards/{boardId}/channels/{channelId}/memory/summary   running summary
 *   boards/{boardId}/notes/{noteId}                        durable notes
 */

export const summaryRef = (boardId: string, channelId: string) =>
    doc(db, 'boards', boardId, 'channels', channelId, 'memory', 'summary');

export const notesRef = (boardId: string) => collection(db, 'boards', boardId, 'notes');

// Notes are read on every bot turn; a meeting takes several turns in a row,
// so they are cached briefly rather than fetched each time.
const NOTES_TTL_MS = 30_000;
const notesCache = new Map<string, { at: number, notes: MemoryNote[] }>();

export const cacheNotes = (boardId: string, notes: MemoryNote[]) =>
    notesCache.set(boardId, { at: Date.now(), notes });

export const forgetNotes = (boardId: string) => notesCache.delete(boardId);

const PIPEDREAM_WORKER_URL: string = (import.meta.env.VITE_PIPEDREAM_WORKER_URL || '').replace(/\/$/, '');

/** The store bound to one user's settings (their tool tokens). */
export const firestoreStore = (settings: AISettings): AgentStore => ({
    async getSummary(boardId, channelId) {
        const snap = await getDoc(summaryRef(boardId, channelId));
        return snap.exists() ? { ...EMPTY_SUMMARY, ...(snap.data() as ChannelSummary) } : EMPTY_SUMMARY;
    },

    async replaceSummary(boardId, channelId, expected, next) {
        return runTransaction(db, async tx => {
            const snap = await tx.get(summaryRef(boardId, channelId));
            const stored = snap.exists() ? (snap.data() as ChannelSummary).coveredUntil : 0;
            if (stored !== expected) return false;
            tx.set(summaryRef(boardId, channelId), next);
            return true;
        });
    },

    getMessagesSince,

    async postMessage(message) {
        await sendMessage(message);
    },

    async loadNotes(boardId) {
        const cached = notesCache.get(boardId);
        if (cached && Date.now() - cached.at < NOTES_TTL_MS) return cached.notes;

        const snap = await getDocs(query(notesRef(boardId), orderBy('createdAt', 'desc'), limit(300)));
        const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }) as MemoryNote);
        cacheNotes(boardId, notes);
        return notes;
    },

    async addNote(boardId, note) {
        const clean = Object.fromEntries(Object.entries(note).filter(([, v]) => v !== undefined));
        await addDoc(notesRef(boardId), { ...clean, createdAt: Date.now() });
        forgetNotes(boardId);
    },

    async setNoteEmbedding(boardId, noteId, embedding, model) {
        await updateDoc(doc(db, 'boards', boardId, 'notes', noteId), { embedding, embeddingModel: model });
    },

    async toolToken(url) {
        // The Pipedream bridge takes the caller's Firebase ID token; every
        // other server a token the user pasted, which never leaves the browser.
        if (PIPEDREAM_WORKER_URL && url.startsWith(PIPEDREAM_WORKER_URL)) {
            return auth.currentUser?.getIdToken();
        }
        return settings.mcpTokens?.[url]?.trim() || undefined;
    }
});
