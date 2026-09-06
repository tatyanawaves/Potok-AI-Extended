/**
 * Attachment storage on R2.
 *
 * Two namespaces, because the two chat surfaces prove membership differently.
 *
 * `dm/<conversationId>/…` needs no lookup at all: a conversation id is
 * `dm_<uidA>_<uidB>`, so the key already names everyone entitled to the file.
 *
 * `board/<boardId>/…` cannot work that way — a board id says nothing about who
 * belongs to it. Rather than give this worker admin credentials, membership is
 * checked by reading the board from Firestore's REST API with the *caller's*
 * own ID token, which makes Firestore apply the same security rules it applies
 * to the app. A member gets 200, everyone else gets denied.
 */

/**
 * The slice of R2 this module uses.
 *
 * Declared structurally rather than taken from Cloudflare's globals so the
 * file can be type-checked and tested outside the worker's own tsconfig.
 */
export interface FileBucket {
    put(
        key: string,
        value: ArrayBuffer,
        options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }
    ): Promise<unknown>;
}

/** Workers cap request bodies well above this; the limit is a product choice. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface UploadedFile {
    key: string;
    name: string;
    size: number;
    contentType: string;
}

/** The two uids a direct-message conversation id is built from. */
const participantsOf = (conversationId: string): string[] => {
    if (!conversationId.startsWith('dm_')) return [];
    return conversationId.slice(3).split('_').filter(Boolean);
};

export const mayAccessConversation = (conversationId: string, uid: string): boolean =>
    participantsOf(conversationId).includes(uid);

/**
 * Strips a filename down to something safe to put in a key.
 *
 * The stored name is only a label — the key's uniqueness comes from the random
 * prefix — so mangling an odd name is preferable to letting it shape the path.
 */
const safeName = (name: string): string => {
    const cleaned = name
        // Dropped, not substituted: replacing "/" with "_" left "../.." as
        // ".._..", which is meaningless in a key and merely looks like an
        // escape attempt that got through.
        .replace(/[^\p{L}\p{N}. _-]/gu, '')
        .replace(/\.{2,}/g, '.')
        // A name of nothing but separators has no content to keep.
        .replace(/^[\s._-]+|[\s._-]+$/g, '')
        .slice(0, 80);

    return cleaned || 'file';
};

export const keyFor = (conversationId: string, name: string): string =>
    `dm/${conversationId}/${crypto.randomUUID()}-${safeName(name)}`;

export const boardKeyFor = (boardId: string, name: string): string =>
    `board/${boardId}/${crypto.randomUUID()}-${safeName(name)}`;

/** The conversation a key belongs to, or null if the key is not one of ours. */
export const conversationOfKey = (key: string): string | null => {
    const parts = key.split('/');
    if (parts.length < 3 || parts[0] !== 'dm') return null;
    return parts[1] || null;
};

/** The board a key belongs to, or null if the key is not a board attachment. */
export const boardOfKey = (key: string): string | null => {
    const parts = key.split('/');
    if (parts.length < 3 || parts[0] !== 'board') return null;
    return parts[1] || null;
};

/**
 * Whether the caller belongs to a board, asked of Firestore as the caller.
 *
 * Passing the user's own ID token makes Firestore enforce the board's read
 * rule, which already restricts reads to members. That keeps this worker free
 * of any credential that could read data on its own behalf.
 */
export const isBoardMember = async (
    projectId: string,
    boardId: string,
    idToken: string
): Promise<boolean> => {
    const url =
        `https://firestore.googleapis.com/v1/projects/${projectId}` +
        `/databases/(default)/documents/boards/${encodeURIComponent(boardId)}`;

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` }
    });

    return response.ok;
};

export const putFile = async (
    bucket: FileBucket,
    key: string,
    body: ArrayBuffer,
    contentType: string
): Promise<void> => {
    await bucket.put(key, body, {
        httpMetadata: {
            contentType: contentType || 'application/octet-stream',
            // Attachments are served through the worker, never rendered inline
            // from it: an HTML or SVG upload would otherwise run as script on
            // the worker's own origin.
            contentDisposition: 'attachment'
        }
    });
};
