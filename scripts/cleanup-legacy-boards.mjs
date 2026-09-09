#!/usr/bin/env node
/**
 * One-off cleanup for the first (flat) boards schema.
 *
 * Boards originally stored channels and messages in two top-level collections:
 *
 *   board_channels/{channelId}     -> { boardId, name, ... }
 *   board_messages/{messageId}     -> { boardId, channelId, content, ... }
 *
 * They now live as subcollections under the board they belong to:
 *
 *   boards/{boardId}/channels/{channelId}/messages/{messageId}
 *
 * The old collections are no longer read by the app and are not covered by
 * firestore.rules any more, so their documents are unreachable from the client
 * and can only be removed with admin credentials — which is what the Firebase
 * CLI already has after `firebase login`.
 *
 * Usage:
 *   node scripts/cleanup-legacy-boards.mjs                 # dry run, prints the plan
 *   node scripts/cleanup-legacy-boards.mjs --confirm       # actually deletes
 *   node scripts/cleanup-legacy-boards.mjs --confirm --board <boardId>
 *                                                          # also deletes one stale board
 *
 * Deleting a board with --board removes the board document together with every
 * channel and message nested under it. Use it for boards created before the
 * migration, whose channels ended up orphaned in the old collections.
 */

import { spawnSync } from 'node:child_process';

const LEGACY_COLLECTIONS = ['board_channels', 'board_messages'];

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');

const boardFlagIndex = args.indexOf('--board');
const boardId = boardFlagIndex !== -1 ? args[boardFlagIndex + 1] : null;

if (boardFlagIndex !== -1 && !boardId) {
    console.error('Error: --board requires a board id.');
    process.exit(1);
}

const targets = [
    ...LEGACY_COLLECTIONS.map(name => ({
        path: name,
        label: `legacy collection ${name}/`
    })),
    ...(boardId ? [{ path: `boards/${boardId}`, label: `board ${boardId} (with all channels and messages)` }] : [])
];

console.log('Firestore cleanup — the following paths will be deleted recursively:\n');
for (const target of targets) {
    console.log(`  • ${target.label}`);
}

if (!confirmed) {
    console.log('\nDry run. Nothing was deleted.');
    console.log('Re-run with --confirm to apply. This cannot be undone.');
    process.exit(0);
}

console.log('\nDeleting...\n');

let failed = 0;

for (const target of targets) {
    // The Firebase CLI reuses the credentials from `firebase login` and handles
    // recursive deletes in batches, so no service account key is needed here.
    const result = spawnSync(
        'firebase',
        ['firestore:delete', target.path, '--recursive', '--force'],
        { stdio: 'inherit', shell: true }
    );

    if (result.status !== 0) {
        console.error(`Failed to delete ${target.path}`);
        failed++;
    }
}

if (failed > 0) {
    console.error(`\nDone with ${failed} failure(s).`);
    process.exit(1);
}

console.log('\nCleanup complete.');
