import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Posts that go to the feed later (worker/src/scheduledPosts). The post is
 * kept in the author's private queue; the worker publishes it at its time,
 * signed in as them, so the tab does not need to be open.
 */

const WORKER: string = (import.meta.env.VITE_PIPEDREAM_WORKER_URL || '').replace(/\/$/, '');

/** The cron runs every five minutes, so a post goes out within that of its time. */
export const PUBLISH_STEP_MINUTES = 5;

export interface ScheduledPost {
    id: string;
    content: string;
    publishAt: number;
    createdAt: number;
    type?: string;
    modelName?: string;
}

export const scheduledPostsAvailable = (): boolean => Boolean(WORKER);

const callWorker = async (path: string, body: unknown) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const response = await fetch(`${WORKER}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as any).error || `Сервер ответил ${response.status}`);
    }
};

/** Firestore takes no undefined fields; the post object may carry some. */
const clean = (data: Record<string, any>) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

/** Queues a ready post for `publishAt` (ms). */
export const schedulePost = async (post: Record<string, any>, publishAt: number): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    if (publishAt <= Date.now()) throw new Error('Время публикации уже прошло');
    const { likes, likedBy, timestamp, comments, ...rest } = post;
    const ref = await addDoc(collection(db, 'users', user.uid, 'scheduledPosts'), clean({
        ...rest,
        content: String(post.content || '').slice(0, 1000),
        authorId: user.uid,
        publishAt,
        createdAt: Date.now()
    }));
    try {
        await callWorker('/posts/schedule', { postId: ref.id, refreshToken: user.refreshToken });
    } catch (error) {
        // A post the server cannot publish should not wait there forever.
        await deleteDoc(ref).catch(() => { });
        throw error;
    }
};

export const subscribeToScheduledPosts = (uid: string, callback: (posts: ScheduledPost[]) => void) =>
    onSnapshot(
        query(collection(db, 'users', uid, 'scheduledPosts'), orderBy('publishAt', 'asc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ScheduledPost)),
        () => callback([])
    );

export const cancelScheduledPost = async (id: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'scheduledPosts', id));
    await callWorker('/posts/unschedule', { postId: id }).catch(() => { /* the next tick forgets it */ });
};
