/**
 * firestore.rules against the Firestore emulator: `npm run test:rules`.
 *
 * The writes below are the ones the app makes (services/firebase.ts,
 * services/comments.ts, services/boards.ts, worker/src/firestoreRest.ts), so
 * a rule that refuses them fails here rather than in someone's browser.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection,
    query, orderBy, limit, arrayUnion, arrayRemove, increment
} from 'firebase/firestore';
import { FirestoreRest, restAgentStore } from '../../worker/src/firestoreRest';
import { botIdsOf } from '../../services/mentions';
import { newCommentData, MAX_COMMENT_LENGTH } from '../../services/comments';
import type { BoardMember } from '../../types';

// Not demo-potok: that is the project `npm run emulators` serves the app
// from, and loading rules or clearing data there would wipe a manual session.
const PROJECT = 'demo-rules-test';
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

let env: RulesTestEnvironment;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: {
            rules: readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
            host: HOST,
            port: Number(PORT)
        }
    });
});

afterAll(async () => {
    await env?.cleanup();
});

beforeEach(async () => {
    await env.clearFirestore();
});

/** Two accounts may share a display name; only the uid tells them apart. */
const SHARED_NAME = 'Neo';
const as = (uid: string) => env.authenticatedContext(uid, { name: SHARED_NAME }).firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const seed = (write: (db: any) => Promise<unknown>) =>
    env.withSecurityRulesDisabled(context => write(context.firestore()).then(() => undefined));

const read = async (path: string): Promise<any> => {
    let data: any;
    await env.withSecurityRulesDisabled(async context => {
        data = (await getDoc(doc(context.firestore(), path))).data();
    });
    return data;
};

// --- Posts ---------------------------------------------------------------------------

describe('posts', () => {
    const post = {
        authorId: 'alice',
        authorName: SHARED_NAME,
        authorType: 'human',
        content: 'original',
        timestamp: 1,
        likes: 0,
        likedBy: [],
        // Not migrated yet: comments from before they were documents.
        comments: [{ id: 'c1', authorName: 'Bob', content: 'hi', likes: 0, likedBy: [] }]
    };

    /** Written before authorId existed: a name and nothing else. */
    const legacyPost = { authorName: SHARED_NAME, content: 'old', timestamp: 0, likes: 0, likedBy: [], comments: [] };

    beforeEach(async () => {
        await seed(async db => {
            await setDoc(doc(db, 'posts/p1'), post);
            await setDoc(doc(db, 'posts/legacy'), legacyPost);
        });
    });

    describe('create', () => {
        it('lets a user post under their own uid (createPost)', async () => {
            const { comments, ...fresh } = post;
            await assertSucceeds(addDoc(collection(as('alice'), 'posts'), fresh));
        });

        it('still accepts the empty comments array older clients send', async () => {
            await assertSucceeds(addDoc(collection(as('alice'), 'posts'), { ...post, comments: [] }));
        });

        it('refuses a post that arrives with comments already on it', async () => {
            // They would be shown under it, in other people's names.
            await assertFails(addDoc(collection(as('alice'), 'posts'), post));
        });

        it('refuses a post in someone else\'s name', async () => {
            await assertFails(addDoc(collection(as('mallory'), 'posts'), post));
        });

        it('refuses a post with no author and an anonymous one', async () => {
            const { authorId, ...ownerless } = post;
            await assertFails(addDoc(collection(as('alice'), 'posts'), ownerless));
            await assertFails(addDoc(collection(anonymous(), 'posts'), post));
        });
    });

    describe('update by the author', () => {
        it('may edit the post', async () => {
            await assertSucceeds(updateDoc(doc(as('alice'), 'posts/p1'), { content: 'edited' }));
        });

        it('may not hand the post to someone else', async () => {
            await assertFails(updateDoc(doc(as('alice'), 'posts/p1'), { authorId: 'bob' }));
        });

        it('may not rewrite the old comments array, which the app still shows', async () => {
            const db = as('alice');
            await assertFails(updateDoc(doc(db, 'posts/p1'), {
                comments: arrayUnion({ id: 'fake', authorName: 'Bob', content: 'I agree with everything', timestamp: 2 })
            }));
            await assertFails(updateDoc(doc(db, 'posts/p1'), { comments: [] }));
        });
    });

    describe('update by anyone else', () => {
        it('may like and unlike (toggleLike)', async () => {
            const db = as('bob');
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), { likes: increment(1), likedBy: arrayUnion('bob') }));
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), { likes: increment(-1), likedBy: arrayRemove('bob') }));
        });

        it('may not touch the old comments array: add, like or delete in it', async () => {
            // What addComment, toggleCommentLike and deleteComment wrote before
            // comments had documents of their own; an app from then gets this.
            const db = as('bob');
            await assertFails(updateDoc(doc(db, 'posts/p1'), {
                comments: arrayUnion({ id: 'c2', authorName: 'Bob', content: 'reply', timestamp: 2, likes: 0, likedBy: [] })
            }));
            await assertFails(updateDoc(doc(db, 'posts/p1'), {
                comments: [{ ...post.comments[0], likes: 1, likedBy: ['bob'] }]
            }));
            await assertFails(updateDoc(doc(db, 'posts/p1'), { comments: [] }));
        });

        it('may not change the content, the author or the name', async () => {
            const db = as('mallory');
            await assertFails(updateDoc(doc(db, 'posts/p1'), { content: 'defaced' }));
            await assertFails(updateDoc(doc(db, 'posts/p1'), { authorId: 'mallory' }));
            await assertFails(updateDoc(doc(db, 'posts/p1'), { authorName: 'Mallory' }));
        });

        it('may not slip a content change in with a like', async () => {
            await assertFails(updateDoc(doc(as('mallory'), 'posts/p1'), {
                likes: increment(1), likedBy: arrayUnion('mallory'), content: 'defaced'
            }));
        });

        it('may not update anonymously', async () => {
            await assertFails(updateDoc(doc(anonymous(), 'posts/p1'), { likes: increment(1) }));
        });
    });

    describe('delete', () => {
        it('lets the author delete by uid', async () => {
            await assertSucceeds(deleteDoc(doc(as('alice'), 'posts/p1')));
        });

        it('refuses someone who only shares the author\'s display name', async () => {
            await assertFails(deleteDoc(doc(as('mallory'), 'posts/p1')));
        });
    });

    describe('posts from before authorId', () => {
        it('can still be liked', async () => {
            await assertSucceeds(updateDoc(doc(as('bob'), 'posts/legacy'), { likes: increment(1), likedBy: arrayUnion('bob') }));
        });

        it('cannot be edited or deleted by name', async () => {
            const db = as('alice');
            await assertFails(updateDoc(doc(db, 'posts/legacy'), { content: 'claimed' }));
            await assertFails(deleteDoc(doc(db, 'posts/legacy')));
        });
    });
});

// --- Comments --------------------------------------------------------------------------

describe('comments', () => {
    const post = {
        authorId: 'alice', authorName: SHARED_NAME, authorType: 'human',
        content: 'post', timestamp: 1, likes: 0, likedBy: []
    };

    const comments = (db: any, postId = 'p1') => collection(db, 'posts', postId, 'comments');
    const comment = (db: any, id: string, postId = 'p1') => doc(db, 'posts', postId, 'comments', id);

    /** What addComment writes for `uid`. */
    const written = (uid: string, extra: Partial<Parameters<typeof newCommentData>[1]> = {}) =>
        newCommentData(uid, { authorName: SHARED_NAME, authorType: 'human', content: 'hello', ...extra });

    beforeEach(async () => {
        await seed(async db => {
            await setDoc(doc(db, 'posts/p1'), post);
            // Bob's comment, which Carol has liked.
            await setDoc(comment(db, 'c1'), { ...written('bob'), likes: 1, likedBy: ['carol'] });
            // Moved from a post's array by scripts/migrate-comments.mjs: no
            // authorId, and on the oldest ones no like fields either.
            await setDoc(comment(db, 'legacy'), { authorName: 'Bob', authorType: 'human', content: 'old', timestamp: 0 });
        });
    });

    describe('create (addComment)', () => {
        it('lets anyone signed in comment as themselves', async () => {
            await assertSucceeds(addDoc(comments(as('bob')), written('bob')));
        });

        it('lets them reply to a comment', async () => {
            await assertSucceeds(addDoc(comments(as('dave')), written('dave', { parentId: 'c1' })));
        });

        it('lets an agent comment under the uid of whoever runs it', async () => {
            await assertSucceeds(addDoc(comments(as('carol')), written('carol', {
                authorName: 'Helper', authorType: 'agent', content: '~Neo: done'
            })));
        });

        it('refuses a comment in someone else\'s name', async () => {
            await assertFails(addDoc(comments(as('mallory')), written('bob')));
        });

        it('refuses a comment with no author, and an anonymous one', async () => {
            const { authorId, ...ownerless } = written('bob');
            await assertFails(addDoc(comments(as('bob')), ownerless));
            await assertFails(addDoc(comments(anonymous()), written('bob')));
        });

        it('refuses a comment that arrives already liked', async () => {
            const db = as('mallory');
            await assertFails(addDoc(comments(db), { ...written('mallory'), likes: 99 }));
            await assertFails(addDoc(comments(db), { ...written('mallory'), likes: 1, likedBy: ['bob'] }));
        });

        it('refuses fields the app does not write, and a malformed author type', async () => {
            const db = as('bob');
            await assertFails(addDoc(comments(db), { ...written('bob'), pinned: true }));
            await assertFails(addDoc(comments(db), { ...written('bob'), authorType: 'admin' }));
        });

        it('refuses empty content, and content past the limit', async () => {
            const db = as('bob');
            await assertFails(addDoc(comments(db), { ...written('bob'), content: '' }));
            await assertFails(addDoc(comments(db), { ...written('bob'), content: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }));
        });

        it('measures the limit as newCommentData cuts to it', async () => {
            // The rules count UTF-16 units, like JavaScript's length: a
            // Cyrillic letter is one, an emoji two. Not bytes, not code points.
            const db = as('bob');
            await assertSucceeds(addDoc(comments(db), written('bob', { content: 'ж'.repeat(MAX_COMMENT_LENGTH) })));
            await assertSucceeds(addDoc(comments(db), written('bob', { content: 'x' + '😀'.repeat(MAX_COMMENT_LENGTH) })));
            await assertFails(addDoc(comments(db), { ...written('bob'), content: '😀'.repeat(MAX_COMMENT_LENGTH / 2 + 1) }));
        });

        it('refuses a comment on a post that does not exist', async () => {
            await assertFails(addDoc(comments(as('bob'), 'missing'), written('bob')));
        });
    });

    describe('like (toggleCommentLike)', () => {
        const like = (uid: string) => ({ likes: increment(1), likedBy: arrayUnion(uid) });
        const unlike = (uid: string) => ({ likes: increment(-1), likedBy: arrayRemove(uid) });

        it('lets anyone like and unlike in their own name', async () => {
            const db = as('dave');
            await assertSucceeds(updateDoc(comment(db, 'c1'), like('dave')));
            expect(await read('posts/p1/comments/c1')).toMatchObject({ likes: 2, likedBy: ['carol', 'dave'] });

            await assertSucceeds(updateDoc(comment(db, 'c1'), unlike('dave')));
            expect(await read('posts/p1/comments/c1')).toMatchObject({ likes: 1, likedBy: ['carol'] });
        });

        it('lets a comment\'s author like it too', async () => {
            await assertSucceeds(updateDoc(comment(as('bob'), 'c1'), like('bob')));
        });

        it('works on a migrated comment without authorId or like fields', async () => {
            await assertSucceeds(updateDoc(comment(as('dave'), 'legacy'), like('dave')));
            await assertSucceeds(updateDoc(comment(as('dave'), 'legacy'), unlike('dave')));
        });

        it('refuses liking in someone else\'s name', async () => {
            await assertFails(updateDoc(comment(as('mallory'), 'c1'), like('erin')));
        });

        it('refuses taking back someone else\'s like', async () => {
            await assertFails(updateDoc(comment(as('mallory'), 'c1'), unlike('carol')));
        });

        it('refuses liking twice', async () => {
            // arrayUnion changes nothing the second time; the count would.
            await assertFails(updateDoc(comment(as('carol'), 'c1'), like('carol')));
        });

        it('refuses the count without the like, the like without the count, or a jump', async () => {
            const db = as('mallory');
            await assertFails(updateDoc(comment(db, 'c1'), { likes: increment(1) }));
            await assertFails(updateDoc(comment(db, 'c1'), { likedBy: arrayUnion('mallory') }));
            await assertFails(updateDoc(comment(db, 'c1'), { likes: increment(50), likedBy: arrayUnion('mallory') }));
        });

        it('refuses rewriting the list, even to add oneself', async () => {
            // Carol's like disappears: the set is not the old one plus mallory.
            await assertFails(updateDoc(comment(as('mallory'), 'c1'), { likes: 1, likedBy: ['mallory'] }));
        });

        it('refuses an edit slipped in with a like', async () => {
            await assertFails(updateDoc(comment(as('mallory'), 'c1'), { ...like('mallory'), content: 'defaced' }));
        });

        it('refuses anonymous likes', async () => {
            await assertFails(updateDoc(comment(anonymous(), 'c1'), like('anon')));
        });
    });

    describe('edit', () => {
        it('is refused to everyone, the author included', async () => {
            await assertFails(updateDoc(comment(as('bob'), 'c1'), { content: 'edited' }));
            await assertFails(updateDoc(comment(as('bob'), 'c1'), { authorId: 'mallory' }));
            await assertFails(updateDoc(comment(as('alice'), 'c1'), { content: 'moderated' }));
        });
    });

    describe('delete (deleteComment)', () => {
        it('lets the comment\'s author delete it', async () => {
            await assertSucceeds(deleteDoc(comment(as('bob'), 'c1')));
        });

        it('lets the post\'s author delete any comment under it', async () => {
            await assertSucceeds(deleteDoc(comment(as('alice'), 'c1')));
        });

        it('refuses everyone else, including someone with the same display name', async () => {
            // Every account in this suite is called SHARED_NAME, as is c1's author.
            await assertFails(deleteDoc(comment(as('mallory'), 'c1')));
            await assertFails(deleteDoc(comment(anonymous(), 'c1')));
        });

        it('leaves a migrated comment, which has no author id, to the post\'s author', async () => {
            await assertFails(deleteDoc(comment(as('bob'), 'legacy')));
            await assertSucceeds(deleteDoc(comment(as('alice'), 'legacy')));
        });

        it('lets the post\'s author clear the thread and then the post (deletePost)', async () => {
            const db = as('alice');
            await assertSucceeds(Promise.all([deleteDoc(comment(db, 'c1')), deleteDoc(comment(db, 'legacy'))]));
            await assertSucceeds(deleteDoc(doc(db, 'posts/p1')));
        });
    });

    describe('read', () => {
        it('is open to everyone, like the post', async () => {
            await assertSucceeds(getDoc(comment(anonymous(), 'c1')));
            await assertSucceeds(getDocs(query(comments(as('dave')), orderBy('timestamp', 'desc'), limit(500))));
        });
    });
});

// --- Board messages ------------------------------------------------------------------

describe('board messages', () => {
    const BOT = '0b3c9a52-6a1e-4a0e-9f3e-2c1d7f5b8a10';

    const members: BoardMember[] = [
        { id: 'owner', name: 'Owner', type: 'human', role: 'owner', addedAt: 1 },
        { id: 'alice', name: 'Alice', type: 'human', role: 'member', addedAt: 2 },
        { id: BOT, name: 'Helper', type: 'bot', role: 'member', addedAt: 3, ownerId: 'owner' },
        // Legacy: a real account, added as an agent by its uid.
        { id: 'carol', name: 'Carol', type: 'agent', role: 'member', addedAt: 4 }
    ];

    const board = {
        name: 'Team',
        ownerId: 'owner',
        members,
        memberIds: members.map(m => m.id),
        botIds: botIdsOf(members),
        createdAt: 1
    };

    const messages = (db: any, boardId = 'b1') => collection(db, 'boards', boardId, 'channels', 'c1', 'messages');

    const message = (authorId: string, extra: Record<string, unknown> = {}) => ({
        boardId: 'b1', channelId: 'c1', authorId, authorName: 'x', authorType: 'human',
        content: 'hello', mentions: [], timestamp: Date.now(), ...extra
    });

    beforeEach(async () => {
        await seed(async db => {
            await setDoc(doc(db, 'boards/b1'), board);
            await setDoc(doc(db, 'boards/b1/channels/c1'), { boardId: 'b1', name: 'general', createdAt: 1 });
        });
    });

    it('lists only the \'bot\' members in botIds', () => {
        // The legacy agent is a person; listing it would let members post as them.
        expect(botIdsOf(members)).toEqual([BOT]);
    });

    it('lets a member post as themselves', async () => {
        await assertSucceeds(addDoc(messages(as('alice')), message('alice')));
    });

    it('lets a member post a bot\'s reply', async () => {
        await assertSucceeds(addDoc(messages(as('alice')), message(BOT, { authorType: 'agent', isAgentReply: true })));
    });

    it('lets the orchestrator post under its starter\'s uid', async () => {
        await assertSucceeds(addDoc(messages(as('alice')), message('alice', {
            authorName: '🧭 Оркестратор', authorType: 'agent', isAgentReply: true
        })));
    });

    it('refuses a member posting as another human member', async () => {
        await assertFails(addDoc(messages(as('alice')), message('owner')));
    });

    it('refuses posting as a legacy agent member, which is a real account', async () => {
        await assertFails(addDoc(messages(as('alice')), message('carol', { authorType: 'agent' })));
    });

    it('refuses posting as someone outside the board', async () => {
        await assertFails(addDoc(messages(as('alice')), message('stranger')));
    });

    it('refuses a non-member, even as themselves', async () => {
        await assertFails(addDoc(messages(as('stranger')), message('stranger')));
    });

    it('refuses bot replies on a board without botIds, until the owner syncs it', async () => {
        const { botIds, ...legacyBoard } = board;
        await seed(db => setDoc(doc(db, 'boards/old'), legacyBoard));

        await assertFails(addDoc(messages(as('alice'), 'old'), message(BOT, { boardId: 'old' })));
        await assertSucceeds(addDoc(messages(as('alice'), 'old'), message('alice', { boardId: 'old' })));

        // What syncBotIds writes, as the owner.
        await assertSucceeds(updateDoc(doc(as('owner'), 'boards/old'), { botIds: botIdsOf(members) }));
        await assertSucceeds(addDoc(messages(as('alice'), 'old'), message(BOT, { boardId: 'old' })));
    });

    describe('botIds', () => {
        it('only the owner can change them', async () => {
            await assertFails(updateDoc(doc(as('alice'), 'boards/b1'), { botIds: arrayUnion('owner') }));
            await assertSucceeds(updateDoc(doc(as('owner'), 'boards/b1'), { botIds: [BOT] }));
        });

        it('members may still stamp the last message', async () => {
            await assertSucceeds(updateDoc(doc(as('alice'), 'boards/b1'), { lastMessageAt: 5, lastMessageAuthorId: BOT }));
        });

        it('follow addMember and removeMember', async () => {
            const NEW_BOT = '7f1d2e3c-0000-4000-8000-000000000001';
            const owner = as('owner');

            // addMember for a bot, as services/boards.ts writes it.
            await assertSucceeds(updateDoc(doc(owner, 'boards/b1'), {
                members: arrayUnion({ id: NEW_BOT, name: 'Second', type: 'bot', role: 'member', addedAt: 9 }),
                memberIds: arrayUnion(NEW_BOT),
                botIds: arrayUnion(NEW_BOT)
            }));
            await assertSucceeds(addDoc(messages(as('alice')), message(NEW_BOT)));

            // removeMember.
            const stored = await read('boards/b1');
            await assertSucceeds(updateDoc(doc(owner, 'boards/b1'), {
                members: stored.members.filter((m: BoardMember) => m.id !== NEW_BOT),
                memberIds: arrayRemove(NEW_BOT),
                botIds: arrayRemove(NEW_BOT)
            }));
            await assertFails(addDoc(messages(as('alice')), message(NEW_BOT)));
        });
    });

    describe('from the worker, over REST with the starter\'s token', () => {
        /** An unsigned token, which the emulator accepts in place of a real one. */
        const tokenFor = (uid: string) => {
            const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
            const now = Math.floor(Date.now() / 1000);
            return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
                iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT,
                iat: now, exp: now + 3600, auth_time: now,
                sub: uid, user_id: uid,
                firebase: { sign_in_provider: 'custom', identities: {} }
            })}.`;
        };

        const storeFor = (uid: string) => restAgentStore(
            new FirestoreRest(
                { projectId: PROJECT, apiKey: 'unused', firestoreEmulatorHost: `${HOST}:${PORT}` },
                { get: async () => tokenFor(uid) } as any
            ),
            { toolToken: async () => undefined }
        );

        const reply = (authorId: string) => ({
            boardId: 'b1', channelId: 'c1', authorId, authorName: 'Helper', authorType: 'agent' as const,
            content: 'done', isAgentReply: true
        });

        it('posts a bot\'s reply', async () => {
            await assertSucceeds(storeFor('alice').postMessage(reply(BOT)));
        });

        it('posts the orchestrator\'s messages as the starter', async () => {
            await assertSucceeds(storeFor('alice').postMessage(reply('alice')));
        });

        it('cannot post as another human member', async () => {
            // The REST client's own error, not the SDK's, hence no assertFails.
            // Production says "insufficient permissions"; the emulator names the rule.
            await expect(storeFor('alice').postMessage(reply('owner')))
                .rejects.toThrow(/insufficient permissions|false for 'create'/i);
        });
    });
});
