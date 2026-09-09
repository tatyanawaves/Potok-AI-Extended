import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import { SpendState, TokenUsage } from '../types';
import { dayKey } from './usage';

/**
 * What the bots have cost you.
 *
 * Whoever @mentions a bot pays for the reply, on their own key — so the tally
 * is per person and private, next to the read marks in users/{uid}/private.
 *
 * It is a record, not a limit: nothing here refuses a request. The point is
 * that a discussion which burned thirty model calls should not be invisible.
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
        });
    } catch (error) {
        console.error('[Spend] Could not record usage:', error);
    }
};
