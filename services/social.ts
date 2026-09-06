/**
 * Subscriptions.
 *
 * `following` holds uids. It used to hold display names, which broke as soon
 * as someone renamed their profile and forced a name→profile lookup every time
 * a uid was actually needed.
 *
 * Names are still resolved alongside, because posts carry authorName reliably
 * but authorId only since it was added — matching a followed author purely by
 * uid would quietly drop older posts from the feed.
 */

export interface FollowedProfile {
    uid: string;
    name: string;
}

export interface ResolvedFollowing {
    profiles: FollowedProfile[];
    /**
     * The uid list as it should be stored. Differs from the input when legacy
     * name entries were resolved, and the caller should persist it.
     */
    uids: string[];
    migrated: boolean;
}

/**
 * Turns a stored `following` array into profiles, upgrading legacy name
 * entries to uids on the way.
 *
 * Entries are tried as uids first. Anything that resolves to no profile is
 * assumed to be a name left over from the old format and looked up that way,
 * rather than guessing from the shape of the string.
 */
type ProfileLookup = (key: string) => Promise<Record<string, any> | null>;

/**
 * The two lookups this needs, passed in rather than imported.
 *
 * ./firebase opens a Firestore connection and initialises Analytics at import
 * time, which cannot run outside a browser — importing it here would make the
 * migration logic, the part most worth testing, untestable.
 */
export interface ProfileSource {
    byUid: ProfileLookup;
    byName: ProfileLookup;
}

export const resolveFollowing = async (
    entries: string[],
    source: ProfileSource
): Promise<ResolvedFollowing> => {
    const profiles: FollowedProfile[] = [];
    const uids: string[] = [];
    let migrated = false;

    for (const entry of entries) {
        if (!entry) continue;

        try {
            const byUid = await source.byUid(entry);

            if (byUid?.agentName) {
                profiles.push({ uid: entry, name: byUid.agentName });
                uids.push(entry);
                continue;
            }

            const byName = await source.byName(entry);

            if (byName?.uid && byName.agentName) {
                profiles.push({ uid: byName.uid, name: byName.agentName });
                uids.push(byName.uid);
                migrated = true;
                continue;
            }

            // Neither a live uid nor a findable name: the profile is gone.
            // Dropping it is better than keeping an entry nothing can resolve.
            migrated = true;
        } catch (error) {
            console.error('[Social] Could not resolve subscription', entry, error);
            // Kept as-is so a transient failure does not silently unsubscribe.
            uids.push(entry);
        }
    }

    return { profiles, uids, migrated };
};

/**
 * Whether a post belongs to someone followed.
 *
 * Checks the uid first and falls back to the display name, which is what older
 * posts written before authorId existed have to be matched on.
 */
export const isFromFollowed = (
    post: { authorId?: string; authorName?: string },
    followedUids: string[],
    followedNames: string[]
): boolean => {
    if (post.authorId && followedUids.includes(post.authorId)) return true;
    return Boolean(post.authorName && followedNames.includes(post.authorName));
};
