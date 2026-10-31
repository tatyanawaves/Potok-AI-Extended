/**
 * Posts published later: a person writes or generates a post now and picks
 * when it goes out.
 *
 * The post waits in users/{uid}/scheduledPosts/{id}, which only its author
 * reads (firestore.rules), so it is not public before its time. What the
 * server needs to publish it as them — their refresh token — is kept sealed
 * in KV under spost:{uid}:{id}:
 *
 *   POST /posts/schedule    { postId, refreshToken }
 *   POST /posts/unschedule  { postId }
 *
 * Every cron tick (with the bot schedules, ./schedules) publishes the posts
 * whose time has come: reads each as its author, writes it to the feed,
 * removes it from the queue. A post whose queue entry is gone was cancelled
 * and is forgotten.
 */

import { FirestoreRest, TokenSource } from './firestoreRest';
import { firestoreConfig, fixedToken, decodePayload, sealingSecret } from './agentTasks';
import type { ScheduleEnv, ScheduleKv } from './schedules';
import { seal, open } from './taskCrypto';

type Json = (body: unknown, status: number) => Response;

/** Posts published per tick at most: each costs four outgoing requests of a capped budget. */
const MAX_PER_TICK = 8;

const POST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const keyOf = (uid: string, postId: string) => `spost:${uid}:${postId}`;
const pathOf = (uid: string, postId: string) => `users/${uid}/scheduledPosts/${postId}`;

interface QueuedPost { uid: string; postId: string; publishAt: number; sealed: string }

export const handleSchedulePost = async (request: Request, env: ScheduleEnv, uid: string, idToken: string, json: Json): Promise<Response> => {
    if (!env.CONNECTOR_TOKENS || !sealingSecret(env)) return json({ error: 'Scheduled posts are not enabled on this worker' }, 501);
    const body: any = await request.json().catch(() => ({}));
    const postId = typeof body.postId === 'string' ? body.postId : '';
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.slice(0, 4000) : '';
    if (!POST_ID.test(postId) || !refreshToken) return json({ error: 'postId and refreshToken are required' }, 400);

    // Read as the caller: only the author can read their queue.
    const doc = await new FirestoreRest(firestoreConfig(env), fixedToken(idToken)).get(pathOf(uid, postId)).catch(() => null);
    if (!doc) return json({ error: 'Scheduled post not found' }, 404);
    const claims = decodePayload(await new TokenSource(firestoreConfig(env), refreshToken).get());
    if (claims.user_id !== uid && claims.sub !== uid) return json({ error: 'The refresh token belongs to another account' }, 403);

    const queued: QueuedPost = {
        uid, postId,
        publishAt: Number(doc.data.publishAt) || Date.now(),
        sealed: await seal({ refreshToken }, sealingSecret(env))
    };
    await (env.CONNECTOR_TOKENS as ScheduleKv).put(keyOf(uid, postId), JSON.stringify(queued));
    return json({ ok: true }, 200);
};

export const handleUnschedulePost = async (request: Request, env: ScheduleEnv, uid: string, json: Json): Promise<Response> => {
    if (!env.CONNECTOR_TOKENS) return json({ ok: true }, 200);
    const body: any = await request.json().catch(() => ({}));
    const postId = typeof body.postId === 'string' ? body.postId : '';
    if (!POST_ID.test(postId)) return json({ error: 'postId is required' }, 400);
    // The key carries the uid: a person can only drop their own.
    await (env.CONNECTOR_TOKENS as ScheduleKv).delete(keyOf(uid, postId));
    return json({ ok: true }, 200);
};

/** Fields of a queued post that go into the feed; the rest is queue bookkeeping. */
const QUEUE_ONLY = new Set(['publishAt', 'createdAt']);

/** Publishes the posts due at `at`. Returns how many went out. */
export const runDueScheduledPosts = async (env: ScheduleEnv, at: number): Promise<number> => {
    if (!env.CONNECTOR_TOKENS || !sealingSecret(env)) return 0;
    const kv = env.CONNECTOR_TOKENS as ScheduleKv;
    let published = 0;
    let cursor: string | undefined;
    do {
        const page = await kv.list({ prefix: 'spost:', cursor });
        cursor = page.list_complete ? undefined : page.cursor;
        for (const { name } of page.keys) {
            if (published >= MAX_PER_TICK) return published;
            try {
                if (await publishOne(env, kv, name, at)) published++;
            } catch (error) {
                console.error('[scheduledPosts]', name, error);
            }
        }
    } while (cursor);
    return published;
};

const publishOne = async (env: ScheduleEnv, kv: ScheduleKv, key: string, at: number): Promise<boolean> => {
    const raw = await kv.get(key);
    if (!raw) return false;
    const queued = JSON.parse(raw) as QueuedPost;
    if (queued.publishAt > at) return false;

    const { refreshToken } = await open<{ refreshToken: string }>(queued.sealed, sealingSecret(env));
    const rest = new FirestoreRest(firestoreConfig(env), new TokenSource(firestoreConfig(env), refreshToken));
    const path = pathOf(queued.uid, queued.postId);
    const doc = await rest.get(path);
    if (!doc) {
        await kv.delete(key); // cancelled in the app
        return false;
    }

    // Removed from the queue first: a retried tick must not publish twice.
    await kv.delete(key);
    const post = Object.fromEntries(Object.entries(doc.data).filter(([field]) => !QUEUE_ONLY.has(field)));
    await rest.create('posts', { ...post, authorId: queued.uid, timestamp: Date.now(), likes: 0, likedBy: [] });
    await rest.delete(path).catch(() => { });
    return true;
};
