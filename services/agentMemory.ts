import { deleteDoc, doc, onSnapshot, orderBy, limit, query } from 'firebase/firestore';
import { db } from './firebase';
import { AISettings } from '../types';
import { ChannelSummary, EMPTY_SUMMARY, MemoryNote } from './memoryCore';
import { fileNote } from './runtime/memory';
import { firestoreStore, summaryRef, notesRef, cacheNotes, forgetNotes } from './firestoreStore';

/**
 * Agent memory as the interface sees it: live views of the summary and the
 * notes, and the edits a person can make. How bots use memory is in
 * ./runtime/memory; the rules in ./memoryCore.
 */

export const subscribeToSummary = (
    boardId: string,
    channelId: string,
    callback: (summary: ChannelSummary) => void
) => onSnapshot(summaryRef(boardId, channelId),
    snap => callback(snap.exists() ? { ...EMPTY_SUMMARY, ...(snap.data() as ChannelSummary) } : EMPTY_SUMMARY),
    () => callback(EMPTY_SUMMARY));

export const subscribeToNotes = (boardId: string, callback: (notes: MemoryNote[]) => void) =>
    onSnapshot(query(notesRef(boardId), orderBy('createdAt', 'desc'), limit(300)), snap => {
        const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }) as MemoryNote);
        cacheNotes(boardId, notes);
        callback(notes);
    }, () => callback([]));

/** A note written by a person, embedded like the bots' notes when that is on. */
export const addNote = (
    boardId: string,
    note: { text: string, author: string, channelId?: string },
    settings: AISettings
): Promise<void> => fileNote(firestoreStore(settings), settings, boardId, note);

export const deleteNote = async (boardId: string, noteId: string): Promise<void> => {
    await deleteDoc(doc(db, 'boards', boardId, 'notes', noteId));
    forgetNotes(boardId);
};

/** Forgets the channel's summary; the messages themselves stay. */
export const resetSummary = async (boardId: string, channelId: string): Promise<void> => {
    await deleteDoc(summaryRef(boardId, channelId));
};
