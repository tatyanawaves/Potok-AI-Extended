/**
 * A daily ceiling on requests to the model, per person, so a long task, a
 * stream or a loop cannot spend without bound. Counted in the same tally as
 * the spend shown on boards (users/{uid}/private/spend), from the browser and
 * from the server alike.
 */

export const DEFAULT_DAILY_REQUESTS = 300;

/** 0 or less means no ceiling. */
export const dailyLimitOf = (settings?: { dailyRequestLimit?: number }): number =>
    typeof settings?.dailyRequestLimit === 'number' ? settings.dailyRequestLimit : DEFAULT_DAILY_REQUESTS;

export const overLimit = (used: number, limit: number): boolean => limit > 0 && used >= limit;

/** Worded so isFatalProviderError stops a task on it: retrying cannot help today. */
export const limitMessage = (limit: number): string =>
    `Дневной лимит запросов Potok исчерпан (${limit}). Его можно поднять или снять в Настройках.`;

/** The days map with one more request added to `day`. */
export const addToDay = (
    days: Record<string, { requests: number, tokens: number }> | undefined,
    day: string,
    tokens: number,
    requests = 1
): Record<string, { requests: number, tokens: number }> => {
    const current = days?.[day] || { requests: 0, tokens: 0 };
    return { ...(days || {}), [day]: { requests: current.requests + requests, tokens: current.tokens + tokens } };
};

/**
 * Per-run hooks, for the server, where tasks of several people share one
 * process and a module-wide counter would mix them up. The browser uses
 * setUsageSink and setUsageGate instead.
 */
export interface UsageHooks {
    /** Throws when today's ceiling is reached. */
    gate: () => Promise<void>;
    record: (tokens: number) => Promise<void>;
}
