/**
 * firestore.rules against the Firestore emulator: `npm run test:rules`.
 *
 * The writes below are the ones the app makes (services/firebase.ts,
 * services/boards.ts, worker/src/firestoreRest.ts), so a rule that refuses
 * them fails here rather than in someone's browser.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection,
    arrayUnion, arrayRemove, increment
} from 'firebase/firestore';
import { FirestoreRest, restAgentStore } from '../../worker/src/firestoreRest';
import { botIdsOf } from '../../services/mentions';
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
        it('lets a user post under their own uid', async () => {
            await assertSucceeds(addDoc(collection(as('alice'), 'posts'), { ...post, likes: 0, comments: [] }));
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
    });

    describe('update by anyone else', () => {
        it('may like and unlike (toggleLike)', async () => {
            const db = as('bob');
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), { likes: increment(1), likedBy: arrayUnion('bob') }));
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), { likes: increment(-1), likedBy: arrayRemove('bob') }));
        });

        it('may comment (addComment)', async () => {
            await assertSucceeds(updateDoc(doc(as('bob'), 'posts/p1'), {
                comments: arrayUnion({ id: 'c2', authorName: 'Bob', content: 'reply', timestamp: 2, likes: 0, likedBy: [] })
            }));
        });

        it('may rewrite the comments to like or delete one (toggleCommentLike, deleteComment)', async () => {
            const db = as('bob');
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), {
                comments: [{ ...post.comments[0], likes: 1, likedBy: ['bob'] }]
            }));
            await assertSucceeds(updateDoc(doc(db, 'posts/p1'), { comments: [] }));
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
        it('can still be liked and commented on', async () => {
            await assertSucceeds(updateDoc(doc(as('bob'), 'posts/legacy'), { likes: increment(1), likedBy: arrayUnion('bob') }));
        });

        it('cannot be edited or deleted by name', async () => {
            const db = as('alice');
            await assertFails(updateDoc(doc(db, 'posts/legacy'), { content: 'claimed' }));
            await assertFails(deleteDoc(doc(db, 'posts/legacy')));
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
