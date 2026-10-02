import {
    collection, doc, getCountFromServer, getDocs, onSnapshot, orderBy, query, where, writeBatch
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { AISettings } from '../types';
import { embed } from './llm';
import { packVector } from './memoryCore';
import { semanticSearchOn } from './runtime/memory';
import { forgetKnowledge } from './firestoreStore';
import { KnowledgeDoc, MAX_BOARD_CHUNKS, chunkText, titleOf } from './knowledgeCore';

/**
 * The board's knowledge base in Firestore: boards/{id}/knowledge holds one
 * document per upload, boards/{id}/kbChunks its passages, which every turn
 * reads (services/knowledgeCore). Any member adds; the uploader or the board
 * owner removes.
 */

/** Largest file taken, before its text is extracted. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const EMBED_BATCH = 32;

export const subscribeToKnowledge = (boardId: string, callback: (docs: KnowledgeDoc[]) => void) =>
    onSnapshot(
        query(collection(db, 'boards', boardId, 'knowledge'), orderBy('createdAt', 'desc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeDoc)),
        () => callback([])
    );

const textOf = async (file: File): Promise<string> => {
    const binary = file.type === 'application/pdf' || /\.(pdf|docx)$/i.test(file.name);
    if (!binary) return file.text();
    // pdfjs and mammoth are large; fetched only when a document is chosen.
    const { parseDocument } = await import('./documentParser');
    return (await parseDocument(file)).text;
};

/** Adds a file to the board's knowledge base; resolves to how many passages it became. */
export const addToKnowledge = async (
    boardId: string,
    file: File,
    settings: AISettings,
    onProgress?: (note: string) => void
): Promise<number> => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`Файл больше ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ`);

    onProgress?.('читаю…');
    const text = await textOf(file);
    const pieces = chunkText(text);
    if (!pieces.length) throw new Error('В документе не нашлось текста');

    const chunksRef = collection(db, 'boards', boardId, 'kbChunks');
    const have = (await getCountFromServer(chunksRef)).data().count;
    if (have + pieces.length > MAX_BOARD_CHUNKS) {
        throw new Error(`База знаний доски вмещает ${MAX_BOARD_CHUNKS} фрагментов; занято ${have}, документ — ${pieces.length}. Удалите что-нибудь или загрузите часть.`);
    }

    // Vectors now when an embedding model is set; otherwise words only, and
    // the passages get vectors later, when one is (runtime/memory).
    let vectors: (number[] | null)[] = pieces.map(() => null);
    const model = settings.embeddingModel?.trim();
    if (model && semanticSearchOn(settings)) {
        try {
            vectors = [];
            for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
                onProgress?.(`эмбеддинги ${i}/${pieces.length}…`);
                vectors.push(...await embed(pieces.slice(i, i + EMBED_BATCH), settings));
            }
        } catch (error) {
            console.warn('[Knowledge] No vectors, words only:', error);
            vectors = pieces.map(() => null);
        }
    }

    onProgress?.('сохраняю…');
    const docRef = doc(collection(db, 'boards', boardId, 'knowledge'));
    const title = titleOf(file.name);
    const now = Date.now();
    // A batch takes 500 writes; the meta document goes with the last one, so
    // a document is never listed with passages missing.
    const writes = pieces.map((piece, i) => ({ id: `${docRef.id}-${i + 1}`, data: {
        docId: docRef.id, title, index: i + 1, text: piece,
        author: title, addedBy: uid, createdAt: now,
        ...(vectors[i] ? { embedding: packVector(vectors[i]!), embeddingModel: model } : {})
    } }));
    for (let i = 0; i < writes.length; i += 450) {
        const batch = writeBatch(db);
        for (const w of writes.slice(i, i + 450)) batch.set(doc(chunksRef, w.id), w.data);
        if (i + 450 >= writes.length) {
            batch.set(docRef, {
                title, chunks: pieces.length, chars: text.length,
                addedBy: uid, addedByName: (settings.agentName || 'User').slice(0, 60), createdAt: now
            });
        }
        await batch.commit();
    }
    forgetKnowledge(boardId);
    return pieces.length;
};

export const removeFromKnowledge = async (boardId: string, docId: string): Promise<void> => {
    const chunks = await getDocs(query(collection(db, 'boards', boardId, 'kbChunks'), where('docId', '==', docId)));
    const refs = [...chunks.docs.map(d => d.ref), doc(db, 'boards', boardId, 'knowledge', docId)];
    for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        refs.slice(i, i + 450).forEach(ref => batch.delete(ref));
        await batch.commit();
    }
    forgetKnowledge(boardId);
};
