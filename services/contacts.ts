/**
 * The line under a person in the list. Two people may share a name (one
 * person may even have two accounts), and a forward must not reach the
 * wrong one: a shared name gets the profile's role and the end of the id.
 */
export const contactHint = (
    contact: { uid: string, name: string, role?: string },
    all: Array<{ uid: string, name: string }>,
    note?: string
): string | undefined => {
    const shared = all.filter(c => c.name.trim().toLowerCase() === contact.name.trim().toLowerCase()).length > 1;
    const parts = [
        ...(shared ? [contact.role || '', `id …${contact.uid.slice(-4)}`] : []),
        note || ''
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
};
