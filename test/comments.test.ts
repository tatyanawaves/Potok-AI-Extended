import { describe, it, expect } from 'vitest';
import {
    newCommentData, mergeLegacyComments, canDeleteComment, MAX_COMMENT_LENGTH
} from '../services/comments';
import type { Comment } from '../types';

const comment = (id: string, extra: Partial<Comment> = {}): Comment => ({
    id, authorName: 'Neo', authorType: 'human', content: id, timestamp: 1, likes: 0, likedBy: [], ...extra
});

describe('newCommentData', () => {
    it('owns the comment by uid and starts it unliked', () => {
        const data = newCommentData('alice', { authorName: 'Neo', authorType: 'agent', content: 'hi' });

        expect(data).toMatchObject({
            authorId: 'alice', authorName: 'Neo', authorType: 'agent', content: 'hi', likes: 0, likedBy: []
        });
        expect(typeof data.timestamp).toBe('number');
    });

    it('leaves parentId out of a top-level comment', () => {
        // Firestore rejects a field set to undefined.
        const data = newCommentData('alice', { authorName: 'Neo', authorType: 'human', content: 'hi', parentId: undefined });
        expect('parentId' in data).toBe(false);
    });

    it('keeps parentId on a reply', () => {
        expect(newCommentData('alice', { authorName: 'Neo', authorType: 'human', content: 'hi', parentId: 'c1' }).parentId)
            .toBe('c1');
    });

    it('cuts an overlong reply to the rules\' limit, which counts as length does', () => {
        const long = 'x'.repeat(MAX_COMMENT_LENGTH + 10);
        const { content } = newCommentData('alice', { authorName: 'Neo', authorType: 'agent', content: long });

        expect(content).toHaveLength(MAX_COMMENT_LENGTH);
    });

    it('never cuts through an emoji, which is two units long', () => {
        // One letter first, so the limit falls in the middle of an emoji.
        const long = 'x' + '😀'.repeat(MAX_COMMENT_LENGTH);
        const { content } = newCommentData('alice', { authorName: 'Neo', authorType: 'agent', content: long });

        expect(content).toHaveLength(MAX_COMMENT_LENGTH - 1);
        expect(content.endsWith('😀')).toBe(true);
    });

    it('leaves a comment within the limit as it is', () => {
        expect(newCommentData('alice', { authorName: 'Neo', authorType: 'human', content: 'привет 😀' }).content)
            .toBe('привет 😀');
    });
});

describe('mergeLegacyComments', () => {
    it('shows the documents when there is no array', () => {
        expect(mergeLegacyComments(undefined, [comment('a')])).toEqual([comment('a')]);
    });

    it('adds unmigrated array entries, marked read-only, oldest first', () => {
        const merged = mergeLegacyComments(
            [comment('old', { timestamp: 1 })],
            [comment('new', { timestamp: 2, authorId: 'alice' })]
        );

        expect(merged.map(c => c.id)).toEqual(['old', 'new']);
        expect(merged[0].legacyArray).toBe(true);
        expect(merged[1].legacyArray).toBeUndefined();
    });

    it('shows a migrated comment once, as its document', () => {
        // Mid-migration a comment can be in both places, under the same id.
        const merged = mergeLegacyComments([comment('c1')], [comment('c1', { likes: 1, likedBy: ['bob'] })]);

        expect(merged).toHaveLength(1);
        expect(merged[0].legacyArray).toBeUndefined();
        expect(merged[0].likes).toBe(1);
    });

    it('keeps a migrated comment deleted, though a stale copy of the post still has it', () => {
        // Migrated as c1 and c2, then c2 deleted, seen through a post fetched
        // before the migration. Regression: c2 came back, frozen.
        const merged = mergeLegacyComments([comment('c1'), comment('c2')], [comment('c1', { authorId: 'bob' })]);

        expect(merged.map(c => c.id)).toEqual(['c1']);
        expect(merged[0].legacyArray).toBeUndefined();
    });

    it('shows new comments beside an array not migrated yet', () => {
        const merged = mergeLegacyComments([comment('old')], [comment('new', { timestamp: 2, authorId: 'bob' })]);
        expect(merged.map(c => [c.id, Boolean(c.legacyArray)])).toEqual([['old', true], ['new', false]]);
    });
});

describe('canDeleteComment', () => {
    it('lets the comment\'s author delete it', () => {
        expect(canDeleteComment(comment('c', { authorId: 'bob' }), 'alice', 'bob')).toBe(true);
    });

    it('lets the post\'s author delete any comment under it', () => {
        expect(canDeleteComment(comment('c', { authorId: 'bob' }), 'alice', 'alice')).toBe(true);
        expect(canDeleteComment(comment('legacy'), 'alice', 'alice')).toBe(true);
    });

    it('refuses everyone else, however they are named', () => {
        // The old check matched display names, and any human's comment.
        expect(canDeleteComment(comment('c', { authorId: 'bob', authorName: 'Neo' }), 'alice', 'mallory')).toBe(false);
        expect(canDeleteComment(comment('legacy'), 'alice', 'mallory')).toBe(false);
    });

    it('refuses the signed-out, and comments without an owner on posts without one', () => {
        expect(canDeleteComment(comment('c', { authorId: 'bob' }), 'alice', undefined)).toBe(false);
        expect(canDeleteComment(comment('legacy'), undefined, 'mallory')).toBe(false);
    });

    it('refuses entries still in a post\'s array, which the rules freeze', () => {
        expect(canDeleteComment(comment('c', { authorId: 'bob', legacyArray: true }), 'alice', 'alice')).toBe(false);
    });
});
