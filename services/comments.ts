import { Comment } from '../types';

/**
 * Pure helpers for post comments.
 *
 * A comment is a document of its own, posts/{postId}/comments/{commentId},
 * so firestore.rules can tell whose comment is whose: it is created under the
 * writer's uid, deleted by its author or the post's author, and liked only in
 * the liker's own name. They used to be one array on the post, rewritten
 * whole to like or delete one, which let anyone signed in edit anyone's.
 *
 * Kept free of ./firebase, which connects at import time, so that tests and
 * the rules suite can use exactly what the app writes.
 */

/**
 * The longest comment the rules accept. They measure it as JavaScript's
 * `length` does, in UTF-16 units: an emoji counts twice.
 */
export const MAX_COMMENT_LENGTH = 4000;

/** `text` cut to at most `max` UTF-16 units, never through the middle of an emoji. */
const clip = (text: string, max: number): string => {
    if (text.length <= max) return text;

    let clipped = '';
    for (const character of text) {
        if (clipped.length + character.length > max) break;
        clipped += character;
    }
    return clipped;
};

/** What the caller decides about a new comment; addComment fills in the rest. */
export interface NewComment {
    authorName: string;
    authorType: Comment['authorType'];
    content: string;
    parentId?: string;
}

/**
 * A comment document as addComment writes it: owned by `authorId`, dated now
 * and unliked, which is the only shape the rules let a comment start in.
 *
 * Content past the limit is cut rather than refused: a person's comment is
 * capped well below it by the input, so this only ever trims an agent's
 * long reply.
 */
export const newCommentData = (authorId: string, { authorName, authorType, content, parentId }: NewComment) => ({
    authorId,
    authorName,
    authorType,
    content: clip(content, MAX_COMMENT_LENGTH),
    timestamp: Date.now(),
    likes: 0,
    likedBy: [] as string[],
    // Only when present: Firestore rejects a field set to undefined.
    ...(parentId ? { parentId } : {})
});

/**
 * The comments to show under a post, oldest first: its comment documents,
 * plus whatever is still in the array posts carried before, until
 * scripts/migrate-comments.mjs has moved it.
 *
 * The array is frozen by the rules, so its entries are marked and offer no
 * like or delete. The migration keeps each entry's id and copies them all
 * before it removes the array, so once any entry has its document the
 * documents are the whole story: an entry without one was deleted since.
 * That matters to a copy of the post fetched before the migration (a
 * profile's posts are fetched once), which still carries the array.
 */
export const mergeLegacyComments = (legacy: Comment[] | undefined, stored: Comment[]): Comment[] => {
    const byTime = (a: Comment, b: Comment) => (a.timestamp || 0) - (b.timestamp || 0);
    const storedIds = new Set(stored.map(c => c.id));
    const array = (Array.isArray(legacy) ? legacy : []).filter(Boolean);

    if (array.some(c => storedIds.has(c.id))) return [...stored].sort(byTime);

    const unmigrated = array.map(c => ({ ...c, legacyArray: true }));
    return [...unmigrated, ...stored].sort(byTime);
};

/**
 * Whether `uid` may delete a comment, as the rules decide it: the comment's
 * author, or the author of the post it is under. By uid only — two accounts
 * may share a display name — so a comment from before authorId existed can
 * be removed by the post's author alone.
 */
export const canDeleteComment = (
    comment: Comment,
    postAuthorId: string | undefined,
    uid: string | undefined
): boolean =>
    Boolean(uid) && !comment.legacyArray && (comment.authorId === uid || postAuthorId === uid);
