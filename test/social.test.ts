import { describe, it, expect, vi } from 'vitest';
import { isFromFollowed, resolveFollowing, ProfileSource } from '../services/social';

/** Two profiles, reachable by uid or by name, as Firestore would return them. */
const profiles = [
    { uid: 'uid-neonova', agentName: 'Neonova' },
    { uid: 'uid-tatyana', agentName: 'Tatyana' }
];

const source: ProfileSource = {
    byUid: async key => profiles.find(p => p.uid === key) ?? null,
    byName: async key => profiles.find(p => p.agentName === key) ?? null
};

describe('resolveFollowing', () => {
    it('passes uids through without reporting a migration', async () => {
        const result = await resolveFollowing(['uid-neonova'], source);

        expect(result.uids).toEqual(['uid-neonova']);
        expect(result.profiles).toEqual([{ uid: 'uid-neonova', name: 'Neonova' }]);
        expect(result.migrated).toBe(false);
    });

    it('upgrades a legacy name entry to a uid', async () => {
        const result = await resolveFollowing(['Neonova'], source);

        expect(result.uids).toEqual(['uid-neonova']);
        expect(result.migrated).toBe(true);
    });

    it('handles a mix of both formats', async () => {
        const result = await resolveFollowing(['uid-neonova', 'Tatyana'], source);

        expect(result.uids).toEqual(['uid-neonova', 'uid-tatyana']);
        expect(result.migrated).toBe(true);
    });

    it('drops an entry that resolves to nothing', async () => {
        // A deleted profile: keeping an entry nothing can resolve would leave a
        // subscription that can never be displayed or removed.
        const result = await resolveFollowing(['ghost'], source);

        expect(result.uids).toEqual([]);
        expect(result.profiles).toEqual([]);
        expect(result.migrated).toBe(true);
    });

    it('keeps an entry when the lookup itself fails', async () => {
        // A network blip must not silently unsubscribe the user.
        const failing: ProfileSource = {
            byUid: async () => { throw new Error('offline'); },
            byName: async () => { throw new Error('offline'); }
        };

        const result = await resolveFollowing(['uid-neonova'], failing);

        expect(result.uids).toEqual(['uid-neonova']);
    });

    it('never looks up a name for an entry that resolved as a uid', async () => {
        const byName = vi.fn(async () => null);
        await resolveFollowing(['uid-neonova'], { byUid: source.byUid, byName });

        expect(byName).not.toHaveBeenCalled();
    });
});

describe('isFromFollowed', () => {
    const uids = ['uid-neonova'];
    const names = ['Neonova'];

    it('matches on uid', () => {
        expect(isFromFollowed({ authorId: 'uid-neonova', authorName: 'Neonova' }, uids, names))
            .toBe(true);
    });

    it('matches on name when the post carries no uid', () => {
        // Posts written before authorId was recorded have only a name. Matching
        // on uid alone would drop them from a followed author's feed.
        expect(isFromFollowed({ authorName: 'Neonova' }, uids, names)).toBe(true);
    });

    it('matches on uid even when the author has since been renamed', () => {
        // The whole point of storing uids: the subscription survives a rename.
        expect(isFromFollowed({ authorId: 'uid-neonova', authorName: 'Neonova v2' }, uids, names))
            .toBe(true);
    });

    it('rejects an author who is not followed', () => {
        expect(isFromFollowed({ authorId: 'uid-other', authorName: 'Other' }, uids, names))
            .toBe(false);
    });

    it('rejects a post with neither field', () => {
        expect(isFromFollowed({}, uids, names)).toBe(false);
    });

    it('rejects everything when nothing is followed', () => {
        expect(isFromFollowed({ authorId: 'uid-neonova', authorName: 'Neonova' }, [], []))
            .toBe(false);
    });
});
