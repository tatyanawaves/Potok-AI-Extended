import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import { SpendState, TokenUsage } from '../types';
import { dayKey } from './usage';
import { overLimit, limitMessage } from './spendLimit';

/**
 * What the bots have cost you.
 *
 * Whoever @mentions a bot pays for the reply, on their own key — so the tally
 * is per person and private, next to the read marks in users/{uid}/private.
 *
 * The tally also backs the daily ceiling (services/spendLimit): spendGate
 * refuses a request once today's count reaches it.
 */

const spendRefFor = (uid: string) => doc(db, 'users', uid, 'private', 'spend');

export const subscribeToSpend = (uid: string, callback: (state: SpendState) => void) =>
    onSnapshot(spendRefFor(uid), snapshot => {
        callback((snapshot.exists() ? snapshot.data() : { days: {} }) as SpendState);
    }, error => {
        console.error('[Spend] Could not follow usage:', error);
        callback({ days: {} });
    });

/**
 * Adds one model request to today's tally.
 *
 * A transaction because a discussion fires several turns in quick succession
 * and a plain read-modify-write would lose most of them. Failure is swallowed:
 * a bot's answer must not be lost because its bookkeeping did not land.
 */
export const recordSpend = async (usage: TokenUsage, requests = 1): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const day = dayKey();

    try {
        await runTransaction(db, async transaction => {
            const ref = spendRefFor(uid);
            const snapshot = await transaction.get(ref);
            const days = (snapshot.exists() ? (snapshot.data() as SpendState).days : {}) || {};
            const current = days[day] || { requests: 0, tokens: 0 };

            transaction.set(ref, {
                days: {
                    ...days,
                    [day]: {
                        requests: current.requests + requests,
                        tokens: current.tokens + usage.totalTokens
                    }
                }
            }, { merge: true });
            known = { uid, day, requests: current.requests + requests };
        });
    } catch (error) {
        console.error('[Spend] Could not record usage:', error);
    }
};

// --- The daily ceiling ---------------------------------------------------------

let known: { uid: string, day: string, requests: number } | null = null;

const todayRequests = async (uid: string): Promise<number> => {
    const day = dayKey();
    if (known && known.uid === uid && known.day === day) return known.requests;
    const snapshot = await getDoc(spendRefFor(uid)).catch(() => null);
    const requests = (snapshot?.exists() ? (snapshot.data() as SpendState).days?.[day]?.requests : 0) || 0;
    known = { uid, day, requests };
    return requests;
};

/** Refuses a request once today's count reaches the person's ceiling. */
export const spendGate = async (limit: number): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid || limit <= 0) return;
    if (overLimit(await todayRequests(uid), limit)) throw new Error(limitMessage(limit));
};
