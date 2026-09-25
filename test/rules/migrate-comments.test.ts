/**
 * scripts/migrate-comments.mjs against the Firestore emulator, as part of
 * `npm run test:rules`: what it moves, what it keeps, and that what it
 * writes is a comment the rules accept.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, deleteDoc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { initializeApp, deleteApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { migrateComments, commentDocOf } from '../../scripts/migrate-comments.mjs';

// Not demo-rules-test: that suite clears its project between cases, and the
// two files run side by side.
const PROJECT = 'demo-migrate-comments';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [HOST, PORT] = EMULATOR.split(':');

let env: RulesTestEnvironment;
let admin: App;
let db: Firestore;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: {
            rules: readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
            host: HOST,
            port: Number(PORT)
        }
    });

    // The admin SDK finds the emulator through this, as the script does.
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    admin = initializeApp({ projectId: PROJECT }, 'migrate-comments-test');
    db = getFirestore(admin);
});

afterAll(async () => {
    await env?.cleanup();
    if (admin) await deleteApp(admin);
});

beforeEach(async () => {
    await env.clearFirestore();
});

const quiet = { log: () => {} };
const as = (uid: string) => env.authenticatedContext(uid).firestore();

const legacyPost = {
    authorId: 'alice', authorName: 'Alice', authorType: 'human', content: 'post', timestamp: 1, likes: 0, likedBy: [],
    comments: [
        { id: 'c1', authorName: 'Bob', authorType: 'human', content: 'first', timestamp: 2, likes: 1, likedBy: ['carol'] },
        { id: 'c2', parentId: 'c1', authorName: 'Helper', authorType: 'agent', content: 'reply', timestamp: 3, likes: 0, likedBy: [] },
        // An agent's reply, written without the like fields.
        { id: 'c3', authorName: 'Neo', authorType: 'agent', content: 'bare', timestamp: 4 }
    ]
};

const commentsOf = async (postId: string) => Object.fromEntries(
    (await db.collection(`posts/${postId}/comments`).get()).docs.map(d => [d.id, d.data()])
);

describe('migrate-comments', () => {
    it('writes nothing on a dry run, and says what it would do', async () => {
        await db.doc('posts/p1').set(legacyPost);
        const lines: string[] = [];

        const summary = await migrateComments(db, { log: (line: string) => lines.push(line) });

        expect(summary).toMatchObject({ posts: 1, withArrays: 1, comments: 3, toCopy: 3, copied: 0, cleared: 0 });
        expect(lines).toEqual(['  • p1: 3 comment(s), 3 not copied yet']);
        expect(await commentsOf('p1')).toEqual({});
        expect((await db.doc('posts/p1').get()).get('comments')).toHaveLength(3);
    });

    it('copies each entry under its own id and removes the array', async () => {
        await db.doc('posts/p1').set(legacyPost);

        const summary = await migrateComments(db, { confirm: true, ...quiet });

        expect(summary).toMatchObject({ withArrays: 1, copied: 3, cleared: 1 });
        expect(await commentsOf('p1')).toEqual({
            c1: { authorName: 'Bob', authorType: 'human', content: 'first', timestamp: 2, likes: 1, likedBy: ['carol'] },
            // Replies still point at their parents.
            c2: { authorName: 'Helper', authorType: 'agent', content: 'reply', timestamp: 3, likes: 0, likedBy: [], parentId: 'c1' },
            c3: { authorName: 'Neo', authorType: 'agent', content: 'bare', timestamp: 4, likes: 0, likedBy: [] }
        });

        const post = (await db.doc('posts/p1').get()).data()!;
        expect(post.comments).toBeUndefined();
        expect(post).toMatchObject({ authorId: 'alice', content: 'post' });
    });

    it('can be run again: what is already copied keeps the likes given since', async () => {
        await db.doc('posts/p1').set(legacyPost);
        // A run that stopped after c1, which Dave has liked since.
        await db.doc('posts/p1/comments/c1').set({ ...commentDocOf(legacyPost.comments[0]).data, likes: 2, likedBy: ['carol', 'dave'] });

        const summary = await migrateComments(db, { confirm: true, ...quiet });

        expect(summary).toMatchObject({ toCopy: 2, copied: 2, cleared: 1 });
        expect((await commentsOf('p1')).c1).toMatchObject({ likes: 2, likedBy: ['carol', 'dave'] });

        const again = await migrateComments(db, { confirm: true, ...quiet });
        expect(again).toMatchObject({ withArrays: 0, copied: 0 });
        expect(Object.keys(await commentsOf('p1')).sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('leaves posts without an array alone', async () => {
        const { comments, ...modern } = legacyPost;
        await db.doc('posts/p2').set(modern);
        await db.doc('posts/p2/comments/x').set({ authorId: 'bob', content: 'new' });

        const summary = await migrateComments(db, { confirm: true, ...quiet });

        expect(summary).toMatchObject({ posts: 1, withArrays: 0, copied: 0 });
        expect(await commentsOf('p2')).toEqual({ x: { authorId: 'bob', content: 'new' } });
    });

    it('writes comments the rules accept: liked by anyone, deleted by the post\'s author only', async () => {
        await db.doc('posts/p1').set(legacyPost);
        await migrateComments(db, { confirm: true, ...quiet });

        await assertSucceeds(updateDoc(doc(as('dave'), 'posts/p1/comments/c3'), { likes: increment(1), likedBy: arrayUnion('dave') }));
        // Bob wrote c1, but nothing on it says so any more.
        await assertFails(deleteDoc(doc(as('bob'), 'posts/p1/comments/c1')));
        await assertSucceeds(deleteDoc(doc(as('alice'), 'posts/p1/comments/c1')));
    });

    describe('commentDocOf', () => {
        it('names an entry without a usable id the same way on every run', () => {
            const entry = { authorName: 'Bob', content: 'no id', timestamp: 5 };
            const { id } = commentDocOf(entry);

            expect(id).toMatch(/^legacy-[0-9a-f]{20}$/);
            expect(commentDocOf({ ...entry }).id).toBe(id);
            expect(commentDocOf({ ...entry, id: 'a/b' }).id).toBe(id);
            expect(commentDocOf({ ...entry, content: 'other' }).id).not.toBe(id);
        });

        it('counts likes from likedBy, and drops an authorId nobody can vouch for', () => {
            const { data } = commentDocOf({
                id: 'x', authorId: 'mallory', authorName: 'Bob', authorType: 'human', content: 'hi', timestamp: 1,
                likes: 99, likedBy: ['a', 'a', 'b', 7]
            });

            expect(data).toEqual({ authorName: 'Bob', authorType: 'human', content: 'hi', timestamp: 1, likes: 2, likedBy: ['a', 'b'] });
        });
    });
});
