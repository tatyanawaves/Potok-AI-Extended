/**
 * The subrequest budget of one server run.
 *
 * Cloudflare caps the outgoing requests one Workflow instance may make: 50
 * on the Workers Free plan, 10,000 by default on Paid. Past the cap every
 * fetch throws — the model, the sandbox, and also the write of the reply and
 * of the error notice, so the person got silence. Each run now counts what
 * it spends and the bot is told to wrap up while there is still enough left
 * to post its answer (services/runtime/turn: budget).
 *
 * Counted per run through AsyncLocalStorage: runs of different people share
 * an isolate and the global fetch. Calls to Cloudflare bindings (KV, R2,
 * Workflows) and in-process calls to this worker are not fetches and are not
 * counted, as Cloudflare does not count them against this cap either.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface Budget {
    /** External requests this run may still make. */
    left(): number;
}

/** Workers Free plan; set SUBREQUEST_LIMIT on a paid plan. */
export const DEFAULT_SUBREQUEST_LIMIT = 50;

const meter = new AsyncLocalStorage<{ used: number }>();
let installed = false;

const install = () => {
    if (installed) return;
    installed = true;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => {
        const run = meter.getStore();
        if (run) run.used++;
        return original(input, init);
    }) as typeof fetch;
};

export const limitOf = (env: { SUBREQUEST_LIMIT?: string }): number => {
    const n = Number(env.SUBREQUEST_LIMIT);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SUBREQUEST_LIMIT;
};

/** Runs `work` with its own count of outgoing requests against `limit`. */
export const withBudget = <T>(limit: number, work: (budget: Budget) => Promise<T>): Promise<T> => {
    install();
    const run = { used: 0 };
    return meter.run(run, () => work({ left: () => limit - run.used }));
};
