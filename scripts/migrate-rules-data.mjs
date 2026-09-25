#!/usr/bin/env node
/**
 * Prepares existing data for the tightened firestore.rules.
 *
 * Writes:
 *   boards/{id}.botIds — the ids of the board's 'bot' members. A member may now
 *   post a message only as themselves or under one of these ids, so on a
 *   board without the field no bot reply can be posted. The app keeps the
 *   field current from here on; this fills it in for boards made before.
 *
 * Reports, and leaves alone:
 *   - Legacy 'agent' board members. They were real accounts added by their
 *     uid, so they are deliberately not put in botIds: that would let every
 *     member of the board post as that person. Their replies can no longer be
 *     posted; the board owner can remove them and clone the persona as a bot.
 *   - Posts without authorId. The rules own posts by uid only, so nobody can
 *     edit or delete these from the app any more; the console still can.
 *
 * Runs with admin credentials, which the rules do not apply to:
 *   gcloud auth application-default login
 *   (or GOOGLE_APPLICATION_CREDENTIALS=<service account key>.json)
 *
 * Usage:
 *   node scripts/migrate-rules-data.mjs              # dry run, prints the plan
 *   node scripts/migrate-rules-data.mjs --confirm    # writes botIds
 *   node scripts/migrate-rules-data.mjs --project <id>
 *
 * With FIRESTORE_EMULATOR_HOST set it talks to the emulators instead (use
 * --project demo-potok there).
 *
 * Order for production: deploy the app, run this with --confirm, then deploy
 * the rules. Run the other way round, bots cannot reply until it has run.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');

const projectFlagIndex = args.indexOf('--project');
const projectId = projectFlagIndex !== -1 ? args[projectFlagIndex + 1] : 'neon-extended';

if (!projectId) {
    console.error('Error: --project requires a project id.');
    process.exit(1);
}

const onEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

initializeApp(onEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

/** Same as botIdsOf in services/mentions.ts: 'bot' members only, never 'agent'. */
const botIdsOf = members => [...new Set((members || []).filter(m => m?.type === 'bot').map(m => m.id))];

const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));

console.log(`Project ${projectId}${onEmulator ? ` (emulator at ${process.env.FIRESTORE_EMULATOR_HOST})` : ''}`);
console.log(confirmed ? 'Writing changes.\n' : 'Dry run: nothing is written.\n');

// --- Boards ------------------------------------------------------------------------

const boards = await db.collection('boards').get();
let toFix = 0;
let fixed = 0;
const legacyAgents = [];

for (const board of boards.docs) {
    const data = board.data();
    const wanted = botIdsOf(data.members);
    const label = `${board.id} "${data.name || ''}"`;

    for (const m of data.members || []) {
        if (m?.type === 'agent') legacyAgents.push(`${label}: ${m.name} (uid ${m.id})`);
    }

    if (Array.isArray(data.botIds) && sameIds(wanted, data.botIds)) continue;
    toFix++;
    console.log(`  • ${label}: botIds ${JSON.stringify(data.botIds ?? null)} -> ${JSON.stringify(wanted)}`);
    if (!confirmed) continue;

    // Read again inside a transaction, so a bot added a moment ago by the
    // owner is not dropped by a list computed from an older copy.
    await db.runTransaction(async tx => {
        const fresh = await tx.get(board.ref);
        if (!fresh.exists) return;
        tx.update(board.ref, { botIds: botIdsOf(fresh.data().members) });
    });
    fixed++;
}

console.log(`\nBoards: ${boards.size}, needing botIds: ${toFix}${confirmed ? `, written: ${fixed}` : ''}.`);

if (legacyAgents.length) {
    console.log(`\nLegacy 'agent' members, not given botIds (their replies will be refused):`);
    legacyAgents.forEach(line => console.log(`  • ${line}`));
}

// --- Posts -------------------------------------------------------------------------

const posts = await db.collection('posts').select('authorId', 'authorName').get();
const ownerless = posts.docs.filter(p => !p.get('authorId'));

console.log(`\nPosts: ${posts.size}, without authorId: ${ownerless.length} (no longer editable or deletable from the app).`);
ownerless.slice(0, 50).forEach(p => console.log(`  • ${p.id} by "${p.get('authorName') ?? '?'}"`));
if (ownerless.length > 50) console.log(`  … and ${ownerless.length - 50} more`);

if (!confirmed && toFix) {
    console.log('\nRe-run with --confirm to write botIds.');
}
