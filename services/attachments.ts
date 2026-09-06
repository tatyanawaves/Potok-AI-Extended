import { auth } from './firebase';
import { PIPEDREAM_WORKER_URL } from './pipedream';

/**
 * Attachments, stored in R2 behind the worker.
 *
 * Firebase Storage would be the obvious home, but it needs the Blaze plan and
 * this project is on Spark. The worker already verifies Firebase ID tokens, so
 * it carries the files too.
 *
 * Downloads go through fetch with an Authorization header rather than a plain
 * URL, so a link cannot leak a private attachment: an <img src> or a shared
 * address carries no credentials and the worker refuses it.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface Attachment {
    key: string;
    name: string;
    size: number;
    contentType: string;
}

export const attachmentsAvailable = (): boolean => Boolean(PIPEDREAM_WORKER_URL);

export const isImage = (attachment: Attachment): boolean =>
    attachment.contentType.startsWith('image/');

export const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const authHeader = async (): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    return `Bearer ${await user.getIdToken()}`;
};

export const uploadAttachment = async (
    conversationId: string,
    file: File
): Promise<Attachment> => {
    if (!PIPEDREAM_WORKER_URL) throw new Error('Attachment storage is not configured');

    if (file.size > MAX_FILE_BYTES) {
        throw new Error(`Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ`);
    }

    const url = new URL(`${PIPEDREAM_WORKER_URL}/files/upload`);
    url.searchParams.set('conversationId', conversationId);
    url.searchParams.set('name', file.name);

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Authorization': await authHeader(),
            'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data as any).error || `Upload failed (${response.status})`);

    return data as Attachment;
};

/**
 * Fetches an attachment and hands back an object URL.
 *
 * The caller owns the URL and must revoke it; holding many undisposed blobs
 * keeps their contents in memory for the life of the page.
 */
export const fetchAttachmentUrl = async (attachment: Attachment): Promise<string> => {
    if (!PIPEDREAM_WORKER_URL) throw new Error('Attachment storage is not configured');

    const url = new URL(`${PIPEDREAM_WORKER_URL}/files`);
    url.searchParams.set('key', attachment.key);

    const response = await fetch(url.toString(), {
        headers: { 'Authorization': await authHeader() }
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as any).error || `Download failed (${response.status})`);
    }

    return URL.createObjectURL(await response.blob());
};

/** Downloads an attachment to disk under its original name. */
export const saveAttachment = async (attachment: Attachment): Promise<void> => {
    const url = await fetchAttachmentUrl(attachment);

    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
};
