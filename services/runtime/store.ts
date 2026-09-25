import { BoardMessage } from '../../types';
import { ChannelSummary, MemoryNote } from '../memoryCore';

/**
 * Everything the agent runtime needs from storage.
 *
 * The runtime — a bot's turn, memory upkeep, an orchestrated task — runs in
 * two places: the browser, through the Firestore web SDK, and the Cloudflare
 * worker for tasks that must outlive a tab, through Firestore's REST API as
 * the user who started them. Both implement this, so there is one copy of
 * the logic and the security rules apply the same way to both.
 */
export interface AgentStore {
    getSummary(boardId: string, channelId: string): Promise<ChannelSummary>;
    /**
     * Writes a new summary only if the stored one still covers
     * `expectedCoveredUntil`; false when someone else compacted first.
     */
    replaceSummary(boardId: string, channelId: string, expectedCoveredUntil: number, next: ChannelSummary): Promise<boolean>;
    /** Messages newer than `since`, oldest first, at most the newest `count`. */
    getMessagesSince(boardId: string, channelId: string, since: number, count: number): Promise<BoardMessage[]>;
    postMessage(message: Omit<BoardMessage, 'id' | 'timestamp' | 'mentions'>): Promise<void>;
    loadNotes(boardId: string): Promise<MemoryNote[]>;
    addNote(boardId: string, note: Omit<MemoryNote, 'id' | 'createdAt'>): Promise<void>;
    setNoteEmbedding(boardId: string, noteId: string, embedding: string, model: string): Promise<void>;
    /** Bearer token for a tool server, when it needs one. */
    toolToken(url: string): Promise<string | undefined>;
}
