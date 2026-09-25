#!/usr/bin/env node
/**
 * Moves post comments out of the array each post used to carry and into
 * posts/{postId}/comments/{commentId}, where firestore.rules can tell whose
 * comment is whose.
 *
 * Each entry becomes a document under the id it already had, so replies keep
 * pointing at their parents, and the app — which shows entries still in an
 * array read-only in the meantime — shows each comment once. An entry with no
 * usable id gets one derived from its content, the same on every run.
 *
 * The documents carry no authorId. The array never recorded one, anyone
 * signed in could rewrite it, and a display name is not unique, so none is
 * guessed. These comments can be liked like any other, and deleted by the
 * post's author only.
 *
 * Once a post's comments are all copied its array is removed, in a
 * transaction that reads the post again first: an entry added meanwhile (by
 * an app still on the old rules) is copied then rather than lost. Running it
 * again is safe; a comment already copied is left as it is, likes and all.
 *
 * Runs with admin credentials, which the rules do not apply to:
 *   gcloud auth application-default login
 *   (or GOOGLE_APPLICATION_CREDENTIALS=<service account key>.json)
 *
 * Usage:
 *   node scripts/migrate-comments.mjs              # dry run, prints the plan
 *   node scripts/migrate-comments.mjs --confirm    # copies, then removes the arrays
 *   node scripts/migrate-comments.mjs --project <id>
 *
 * With FIRESTORE_EMULATOR_HOST set it talks to the emulators instead (use
 * --project demo-potok there).
 *
 * Order for production: once the rules and the app that go with them are
 * deployed (see README). Until it has run, old comments show but cannot be
 * liked or deleted.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Documents per read or write batch, under Firestore's 500. */
const CHUNK = 400;

/** Whether Firestore accepts `id` as a document id. */
const usableId = id =>
    typeof id === 'string' && id.length > 0 && Buffer.byteLength(id) <= 1500
    && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);

/**
 * An array entry as its comment document: `{ id, data }`.
 *
 * Only the fields a comment has. The like count is recomputed from likedBy,
 * the one thing it can be checked against, since from here on the rules move
 * the two together. An authorId in an entry, should there be one, is dropped:
 * anyone could have written it there.
 */
export const commentDocOf = comment => {
    const likedBy = [...new Set(
        (Array.isArray(comment?.likedBy) ? comment.likedBy : []).filter(uid => typeof uid === 'string')
    )];

    const data = {
        authorName: typeof comment?.authorName === 'string' ? comment.authorName : '?',
        authorType: comment?.authorType === 'agent' ? 'agent' : 'human',
        content: typeof comment?.content === 'string' ? comment.content : '',
        timestamp: typeof comment?.timestamp === 'number' ? comment.timestamp : 0,
        likes: likedBy.length,
        likedBy
    };
    if (typeof comment?.parentId === 'string' && comment.parentId) data.parentId = comment.parentId;

    const id = usableId(comment?.id)
        ? comment.id
        : `legacy-${createHash('sha1')
            .update(JSON.stringify([data.timestamp, data.authorName, data.content, data.parentId ?? null]))
            .digest('hex')
            .slice(0, 20)}`;

    return { id, data };
};

/** A post's array as documents, one per id: a repeated id would be one comment written over another. */
const entriesOf = comments => {
    const byId = new Map();
    for (const comment of Array.isArray(comments) ? comments : []) {
        const entry = commentDocOf(comment);
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()];
};

const refOf = (postRef, entry) => postRef.collection('comments').doc(entry.id);

/** The entries that have no document yet. */
const missingOf = async (db, postRef, entries) => {
    const missing = [];
    for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK);
        const snapshots = await db.getAll(...chunk.map(entry => refOf(postRef, entry)));
        snapshots.forEach((snapshot, j) => { if (!snapshot.exists) missing.push(chunk[j]); });
    }
    return missing;
};

const createAll = async (db, postRef, entries) => {
    for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = db.batch();
        entries.slice(i, i + CHUNK).forEach(entry => batch.create(refOf(postRef, entry), entry.data));
        await batch.commit();
    }
};

/**
 * Removes the post's array, copying first whatever in it still has no
 * document. Returns how many it copied: normally none, as createAll has run.
 */
const removeArray = (db, postRef) => db.runTransaction(async tx => {
    const post = await tx.get(postRef);
    if (!post.exists || post.get('comments') === undefined) return 0;

    const entries = entriesOf(post.get('comments'));
    const snapshots = entries.length ? await tx.getAll(...entries.map(entry => refOf(postRef, entry))) : [];
    const missing = entries.filter((_, i) => !snapshots[i].exists);

    if (missing.length > CHUNK) {
        throw new Error(`${postRef.id}: ${missing.length} comments arrived while copying; run again.`);
    }

    missing.forEach(entry => tx.create(refOf(postRef, entry), entry.data));
    tx.update(postRef, { comments: FieldValue.delete() });
    return missing.length;
});

/**
 * Plans the move and, with `confirm`, makes it. Returns the counts it
 * reports; `log` receives one line per post that still has an array.
 */
export const migrateComments = async (db, { confirm = false, log = console.log } = {}) => {
    const posts = await db.collection('posts').select('comments').get();
    const summary = { posts: posts.size, withArrays: 0, comments: 0, toCopy: 0, copied: 0, cleared: 0 };

    for (const post of posts.docs) {
        const array = post.get('comments');
        if (array === undefined) continue;

        const entries = entriesOf(array);
        const missing = await missingOf(db, post.ref, entries);

        summary.withArrays++;
        summary.comments += entries.length;
        summary.toCopy += missing.length;
        log(`  • ${post.id}: ${entries.length} comment(s), ${missing.length} not copied yet`);

        if (!confirm) continue;

        await createAll(db, post.ref, missing);
        summary.copied += missing.length + await removeArray(db, post.ref);
        summary.cleared++;
    }

    return summary;
};

// --- Command line ---------------------------------------------------------------------

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMain = invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
    const args = process.argv.slice(2);
    const confirm = args.includes('--confirm');

    const projectFlagIndex = args.indexOf('--project');
    const projectId = projectFlagIndex !== -1 ? args[projectFlagIndex + 1] : 'neon-extended';

    if (!projectId) {
        console.error('Error: --project requires a project id.');
        process.exit(1);
    }

    const onEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

    initializeApp(onEmulator ? { projectId } : { projectId, credential: applicationDefault() });

    console.log(`Project ${projectId}${onEmulator ? ` (emulator at ${process.env.FIRESTORE_EMULATOR_HOST})` : ''}`);
    console.log(confirm ? 'Writing changes.\n' : 'Dry run: nothing is written.\n');

    const summary = await migrateComments(getFirestore(), { confirm });

    console.log(`\nPosts: ${summary.posts}, with a comments array: ${summary.withArrays}, `
        + `comments in them: ${summary.comments}, not copied yet: ${summary.toCopy}.`);

    if (confirm) {
        console.log(`Copied: ${summary.copied}, arrays removed: ${summary.cleared}.`);
    } else if (summary.withArrays) {
        console.log('\nRe-run with --confirm to copy them and remove the arrays.');
    }
}
