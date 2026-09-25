/**
 * A Firestore listener that comes back after being refused.
 *
 * Firestore closes a listener for good on its first error. A board picked the
 * moment it is created is known to this tab before the server has written it,
 * so the rules — which check membership against the server's copy — refuse,
 * and the channel list never updated again: a new channel did not appear
 * until a reload. A few retries a moment apart cover that window. Any other
 * error is reported and not retried.
 *
 * Kept free of ./firebase so it can be tested without a live SDK.
 */
export const listenWithRetry = (
    subscribe: (onError: (error: unknown) => void) => () => void,
    label: string,
    { retries = 4, delayMs = 500 }: { retries?: number, delayMs?: number } = {}
): (() => void) => {
    let stopped = false;
    let attempt = 0;
    let unsubscribe: () => void = () => { };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = () => {
        unsubscribe = subscribe(error => {
            if (stopped) return;
            const refused = (error as { code?: string } | null)?.code === 'permission-denied';
            if (!refused || attempt >= retries) {
                console.error(`[${label}] Subscription error:`, error);
                return;
            }
            attempt++;
            timer = setTimeout(() => { if (!stopped) start(); }, delayMs * attempt);
        });
    };

    start();

    return () => {
        stopped = true;
        clearTimeout(timer);
        unsubscribe();
    };
};
