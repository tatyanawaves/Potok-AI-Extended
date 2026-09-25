/**
 * Firestore over REST, as a signed-in user.
 *
 * Server tasks act as the person who started them: every request carries that
 * person's ID token, so Firestore applies the same security rules it applies
 * in their browser. The worker holds no credential that could read or write
 * anything on its own behalf.
 *
 * ID tokens last an hour and a task can take longer, so the task carries the
 * user's refresh token (sealed, see ./taskCrypto) and mints fresh ID tokens
 * from it as needed.
 */

import type { AgentStore } from '../../services/runtime/store';
import type { BoardMessage } from '../../types';
import { EMPTY_SUMMARY, type ChannelSummary, type MemoryNote } from '../../services/memoryCore';
import { parseMentions } from '../../services/mentions';

export interface FirestoreConfig {
    projectId: string;
    /** The public Firebase web key, needed to exchange a refresh token. */
    apiKey: string;
    /** host:port of the emulators, for local runs only. */
    firestoreEmulatorHost?: string;
    authEmulatorHost?: string;
}

// --- Tokens -------------------------------------------------------------------------

export class TokenSource {
    private idToken: string | null = null;
    private expiresAt = 0;

    constructor(private config: FirestoreConfig, private refreshToken: string) { }

    async get(): Promise<string> {
        if (this.idToken && Date.now() < this.expiresAt - 5 * 60_000) return this.idToken;

        const host = this.config.authEmulatorHost
            ? `http://${this.config.authEmulatorHost}/securetoken.googleapis.com`
            : 'https://securetoken.googleapis.com';

        const response = await fetch(`${host}/v1/token?key=${encodeURIComponent(this.config.apiKey)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                // Browser keys are often restricted to the site's referrer.
                'Referer': `https://${this.config.projectId}.web.app/`
            },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.refreshToken)}`
        });

        const data: any = await response.json().catch(() => ({}));
        if (!response.ok || !data.id_token) {
            throw new Error(`Не удалось обновить вход: ${data?.error?.message || response.status}`);
        }

        this.idToken = data.id_token;
        this.refreshToken = data.refresh_token || this.refreshToken;
        this.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
        return this.idToken!;
    }
}

// --- Values ---------------------------------------------------------------------------

type Value = Record<string, any>;

export const toValue = (v: unknown): Value => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
    throw new Error(`Cannot store ${typeof v}`);
};

/** Undefined fields are dropped, as the web SDK is asked to do elsewhere. */
export const toFields = (obj: Record<string, unknown>): Record<string, Value> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));

export const fromValue = (v: Value): any => {
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return Date.parse(v.timestampValue);
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
    return null;
};

export const fromFields = (fields: Record<string, Value>): Record<string, any> =>
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));

const idOf = (name: string) => name.split('/').pop()!;

// --- Client ---------------------------------------------------------------------------

export class FirestoreRest {
    private base: string;

    constructor(private config: FirestoreConfig, private tokens: TokenSource) {
        const origin = config.firestoreEmulatorHost
            ? `http://${config.firestoreEmulatorHost}`
            : 'https://firestore.googleapis.com';
        this.base = `${origin}/v1/projects/${config.projectId}/databases/(default)/documents`;
    }

    private async request(path: string, init: RequestInit = {}): Promise<Response> {
        return fetch(`${this.base}${path}`, {
            ...init,
            headers: {
                'Authorization': `Bearer ${await this.tokens.get()}`,
                'Content-Type': 'application/json',
                ...(init.headers || {})
            }
        });
    }

    private async ok(response: Response, what: string): Promise<any> {
        if (response.ok) return response.json();
        const body: any = await response.json().catch(() => ({}));
        throw new Error(`Firestore ${what}: ${body?.error?.message || response.status}`);
    }

    async get(path: string): Promise<{ id: string, data: Record<string, any>, updateTime: string } | null> {
        const response = await this.request(`/${path}`);
        if (response.status === 404) return null;
        const doc = await this.ok(response, `read ${path}`);
        return { id: idOf(doc.name), data: fromFields(doc.fields || {}), updateTime: doc.updateTime };
    }

    async create(collectionPath: string, data: Record<string, unknown>, documentId?: string): Promise<string> {
        const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : '';
        const doc = await this.ok(await this.request(`/${collectionPath}${query}`, {
            method: 'POST',
            body: JSON.stringify({ fields: toFields(data) })
        }), `create in ${collectionPath}`);
        return idOf(doc.name);
    }

    /**
     * Updates the given fields only (an update mask), so security rules that
     * allow a member to touch just some fields see just those fields change.
     */
    async update(path: string, data: Record<string, unknown>, precondition?: string): Promise<boolean> {
        const params = new URLSearchParams();
        Object.keys(data).forEach(k => params.append('updateMask.fieldPaths', k));
        if (precondition) params.append(precondition.split('=')[0], precondition.split('=').slice(1).join('='));

        const response = await this.request(`/${path}?${params}`, {
            method: 'PATCH',
            body: JSON.stringify({ fields: toFields(data) })
        });
        if (precondition && (response.status === 409 || response.status === 412 || response.status === 400)) {
            const body: any = await response.clone().json().catch(() => ({}));
            if (/precondition|FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/i.test(JSON.stringify(body))) return false;
        }
        await this.ok(response, `update ${path}`);
        return true;
    }

    async query(parentPath: string, structuredQuery: Record<string, unknown>): Promise<Array<{ id: string, data: Record<string, any> }>> {
        const parent = parentPath ? `/${parentPath}` : '';
        const rows = await this.ok(await this.request(`${parent}:runQuery`, {
            method: 'POST',
            body: JSON.stringify({ structuredQuery })
        }), `query ${parentPath}`);
        return (rows as any[]).filter(r => r.document).map(r => ({ id: idOf(r.document.name), data: fromFields(r.document.fields || {}) }));
    }
}

// --- The agent store -------------------------------------------------------------------

export const restAgentStore = (
    rest: FirestoreRest,
    options: { toolToken: (url: string) => Promise<string | undefined>, scope?: string }
): AgentStore => {
    const summaryPath = (b: string, c: string) => `boards/${b}/channels/${c}/memory/summary`;
    let notesCache: { boardId: string, at: number, notes: MemoryNote[] } | null = null;

    return {
        scope: options.scope,

        async getSummary(boardId, channelId) {
            const doc = await rest.get(summaryPath(boardId, channelId));
            return doc ? { ...EMPTY_SUMMARY, ...(doc.data as ChannelSummary) } : EMPTY_SUMMARY;
        },

        async replaceSummary(boardId, channelId, expected, next) {
            const doc = await rest.get(summaryPath(boardId, channelId));
            const stored = doc ? Number(doc.data.coveredUntil || 0) : 0;
            if (stored !== expected) return false;
            // Written only if the document is exactly as just read.
            const precondition = doc ? `currentDocument.updateTime=${doc.updateTime}` : 'currentDocument.exists=false';
            return rest.update(summaryPath(boardId, channelId), next as unknown as Record<string, unknown>, precondition);
        },

        async getMessagesSince(boardId, channelId, since, count) {
            const rows = await rest.query(`boards/${boardId}/channels/${channelId}`, {
                from: [{ collectionId: 'messages' }],
                where: { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'GREATER_THAN', value: toValue(since) } },
                orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
                limit: count
            });
            return rows.map(r => ({ id: r.id, ...r.data }) as BoardMessage).reverse();
        },

        async postMessage(message) {
            const timestamp = Date.now();
            await rest.create(`boards/${message.boardId}/channels/${message.channelId}/messages`, {
                ...message,
                mentions: parseMentions(message.content),
                timestamp
            });
            // Stamps for unread dots; best effort, as in the browser.
            const stamp = { lastMessageAt: timestamp, lastMessageAuthorId: message.authorId };
            await Promise.all([
                rest.update(`boards/${message.boardId}/channels/${message.channelId}`, stamp),
                rest.update(`boards/${message.boardId}`, stamp)
            ]).catch(() => { });
        },

        async loadNotes(boardId) {
            if (notesCache && notesCache.boardId === boardId && Date.now() - notesCache.at < 30_000) return notesCache.notes;
            const rows = await rest.query(`boards/${boardId}`, {
                from: [{ collectionId: 'notes' }],
                orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
                limit: 300
            });
            const notes = rows.map(r => ({ id: r.id, ...r.data }) as MemoryNote);
            notesCache = { boardId, at: Date.now(), notes };
            return notes;
        },

        async addNote(boardId, note) {
            await rest.create(`boards/${boardId}/notes`, { ...note, createdAt: Date.now() });
            notesCache = null;
        },

        async setNoteEmbedding(boardId, noteId, embedding, model) {
            await rest.update(`boards/${boardId}/notes/${noteId}`, { embedding, embeddingModel: model });
        },

        toolToken: options.toolToken
    };
};
