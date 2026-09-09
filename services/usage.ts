import { DailySpend, SpendState, TokenUsage } from '../types';

/**
 * Counting what a bot turn costs.
 *
 * Pure, so the arithmetic can be tested without Firestore or a model call;
 * ./spend stores the result and ./boardAgent produces it.
 */

export const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Local calendar day. Spend is shown to one person, in their own timezone. */
export const dayKey = (at: Date = new Date()): string =>
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

/**
 * Reads the usage block of an OpenAI-compatible response.
 *
 * Providers are inconsistent here — some omit `usage` entirely, some send
 * only a total. Missing numbers become zero rather than NaN: an undercount
 * is a worse counter, a NaN is a broken screen.
 */
export const usageFrom = (data: any): TokenUsage => {
    const usage = data?.usage || {};
    const prompt = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? 0) || 0;
    const completion = Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? 0) || 0;
    const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? 0) || prompt + completion;

    return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
};

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens
});

export const spendOn = (state: SpendState | null, day: string = dayKey()): DailySpend =>
    state?.days?.[day] || { requests: 0, tokens: 0 };

/**
 * How many model requests a discussion can reach.
 *
 * Every bot speaks once per round, and a bot with tools may loop back for more
 * rounds of tool calls before it answers. The number is an upper bound, said
 * as one, because the point is to show the ceiling before the run starts —
 * a discussion that quietly cost thirty requests is the thing to prevent.
 */
export const estimateDiscussionRequests = (
    bots: number,
    rounds: number,
    toolRoundsPerTurn = 1
): number => Math.max(0, bots) * Math.max(0, rounds) * Math.max(1, toolRoundsPerTurn);

export const formatTokens = (tokens: number): string => {
    if (tokens < 1000) return String(tokens);
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}K`;
    return `${(tokens / 1_000_000).toFixed(1)}M`;
};
