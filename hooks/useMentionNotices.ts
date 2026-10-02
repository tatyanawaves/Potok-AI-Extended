import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { subscribeToMentions, markMentionRead, MentionNotice } from '../services/mentionNotifications';

/**
 * The person's unread @mentions, wherever they are in the app. A mention
 * that arrives while the tab is in the background also raises a system
 * notification, if they allowed them; the ones already waiting when the
 * page opened do not, so a reload does not replay them.
 */
export const useMentionNotices = () => {
    const [uid, setUid] = useState<string | undefined>(auth.currentUser?.uid);
    useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid)), []);
    const [notices, setNotices] = useState<MentionNotice[]>([]);
    const known = useRef<Set<string> | null>(null);

    useEffect(() => {
        if (!uid) { setNotices([]); return; }
        known.current = null;
        return subscribeToMentions(uid, list => {
            const first = known.current === null;
            const seen = known.current || new Set<string>();
            for (const n of list) {
                if (!first && !seen.has(n.id) && typeof Notification !== 'undefined'
                    && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
                    try { new Notification(`${n.fromName} · #${n.channelName}`, { body: n.text, tag: n.id }); } catch { /* not allowed outside a service worker here */ }
                }
                seen.add(n.id);
            }
            known.current = seen;
            setNotices(list);
        });
    }, [uid]);

    const markRead = (id: string) => {
        setNotices(list => list.filter(n => n.id !== id));
        if (uid) markMentionRead(uid, id).catch(() => { });
    };

    return { notices, markRead };
};
