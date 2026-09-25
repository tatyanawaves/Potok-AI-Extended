import { RefObject, useEffect, useState } from 'react';
import { subscribeToComments } from '../services/firebase';
import { Comment } from '../types';

/** How far ahead of the visible area a card starts loading its comments. */
const PRELOAD_MARGIN = '600px 0px';

/** The element whose scrolling brings the card into view: the feed, not the page. */
const scrollParentOf = (element: Element): Element | null => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const { overflowY } = getComputedStyle(parent);
        if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    }
    return null;
};

/**
 * A post's comments, live, from the moment its card comes near the screen.
 * null until they have arrived.
 *
 * Comments are a subcollection, so each card needs a listener of its own, and
 * the feed holds up to 200 posts: starting them all at once would open 200
 * listeners for cards nobody may scroll to. A card starts listening as it
 * approaches the visible area and keeps listening until it unmounts, so
 * scrolling back does not read everything again.
 *
 * Local writes show at once: Firestore reports them to the listener before
 * the server confirms, so nothing here needs updating by hand.
 */
export const usePostComments = (postId: string | undefined, card: RefObject<Element | null>): Comment[] | null => {
    const [near, setNear] = useState(false);
    const [comments, setComments] = useState<Comment[] | null>(null);

    useEffect(() => {
        const element = card.current;
        if (near || !element) return;

        if (typeof IntersectionObserver === 'undefined') {
            setNear(true);
            return;
        }

        const observer = new IntersectionObserver(
            entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); },
            { root: scrollParentOf(element), rootMargin: PRELOAD_MARGIN }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [near, card]);

    useEffect(() => {
        if (!near || !postId) return;
        setComments(null);
        return subscribeToComments(postId, setComments);
    }, [near, postId]);

    return comments;
};
