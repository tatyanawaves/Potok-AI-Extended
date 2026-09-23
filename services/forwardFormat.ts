import { ForwardOrigin, MessageAttachment } from '../types';

/**
 * The pure half of forwarding: what is being sent, where it can go, and what
 * the copy says. Kept apart from ./forward, which talks to Firestore, so these
 * rules can be tested without a live SDK.
 */

/** Anything on the site that can be forwarded, reduced to what a copy needs. */
export interface ForwardPayload {
    text: string;
    attachments?: MessageAttachment[];
    /** Public image of a feed post; carried as a link where images can't be. */
    imageUrl?: string;
    origin: ForwardOrigin;
}

export type ForwardTarget =
    | { kind: 'feed' }
    | { kind: 'channel', boardId: string, channelId: string, label: string }
    | { kind: 'conversation', conversationId: string, label: string }
    /** Someone with no conversation yet; one is opened on send. */
    | { kind: 'person', uid: string, name: string };

/** A stable id for a destination, used for selection and results. */
export const targetKey = (target: ForwardTarget): string => {
    switch (target.kind) {
        case 'feed': return 'feed';
        case 'channel': return `channel:${target.boardId}/${target.channelId}`;
        case 'conversation': return `dm:${target.conversationId}`;
        case 'person': return `person:${target.uid}`;
    }
};

export const targetLabel = (target: ForwardTarget): string => {
    switch (target.kind) {
        case 'feed': return 'Лента';
        case 'channel': return target.label;
        case 'conversation': return target.label;
        case 'person': return target.name;
    }
};

/**
 * The text of the copy in a chat. A post's image is public, so where a chat
 * cannot show it inline its link goes along instead of being lost.
 */
export const chatText = (payload: ForwardPayload): string =>
    [payload.text.trim(), payload.imageUrl].filter(Boolean).join('\n');

/**
 * The text of the copy in the feed. The sender's note is not part of it: it is
 * stored beside it and shown above the quote, the way a comment goes first in
 * a chat.
 *
 * The feed is public and cannot hold private attachments — they live behind
 * the worker, readable only inside their board or conversation — so their
 * names are listed rather than silently dropped.
 */
export const feedText = (payload: ForwardPayload): string => {
    const files = payload.attachments?.length
        ? `📎 ${payload.attachments.map(a => a.name).join(', ')}`
        : '';
    return [payload.text.trim(), files].filter(Boolean).join('\n\n');
};

/** Firestore rejects undefined, and optional origin fields often are. */
export const cleanOrigin = (origin: ForwardOrigin): ForwardOrigin =>
    Object.fromEntries(
        Object.entries(origin).filter(([, value]) => value !== undefined && value !== '')
    ) as unknown as ForwardOrigin;

/** "Forwarded from Neo · #general · Marketing", for the header of a copy. */
export const describeOrigin = (origin: ForwardOrigin, prefix = 'Переслано от'): string =>
    [`${prefix} ${origin.authorName}`, origin.place].filter(Boolean).join(' · ');

/** Whether a forward would carry nothing at all. */
export const isEmptyPayload = (payload: ForwardPayload): boolean =>
    !payload.text.trim() && !payload.imageUrl && !(payload.attachments?.length);
