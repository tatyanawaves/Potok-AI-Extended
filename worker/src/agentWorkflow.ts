/**
 * The durable run of a server task. See ./agentTasks for how one is started.
 *
 * Each piece of the orchestration (../../services/runtime/orchestrate) is a
 * Workflow step. Cloudflare records a step's result once it returns; if the
 * worker restarts, run() is replayed and finished steps return their recorded
 * results instead of running again — so a task resumes at the wave it was on,
 * and the bots do not repeat work already posted.
 *
 * Kept in its own module because `cloudflare:workers` exists only inside the
 * Workers runtime, and ./index is also imported by the Node test suite.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { startRun, iterate, finishRun, type RunState } from '../../services/runtime/orchestrate';
import { openRuntime, type TaskParams } from './agentTasks';
import worker, { type Env } from './index';

/** Upper bound on waves, far above what MAX_ORCHESTRATED_STEPS allows. */
const MAX_WAVES = 40;

// Results are plain JSON; the cast only quiets the Serializable constraint.
const plain = <T>(value: T): any => JSON.parse(JSON.stringify(value));

export class AgentTaskWorkflow extends WorkflowEntrypoint<Env, TaskParams> {
    async run(event: Readonly<WorkflowEvent<TaskParams>>, step: WorkflowStep): Promise<unknown> {
        const params = event.payload;
        const rt = await openRuntime(this.env, params, request => worker.fetch(request, this.env));

        const bookkeeping = { retries: { limit: 1, delay: '15 seconds' as const }, timeout: '15 minutes' as const };

        try {
            await step.do('start', async () => {
                await rt.setTask({ status: 'running', phase: 'planning' });
                return true;
            });

            let state: RunState = await step.do('plan', bookkeeping, async () => plain(await startRun(rt.ctx)));

            for (let wave = 0; !state.finished && wave < MAX_WAVES; wave++) {
                const cancelled = await step.do(`cancel-check-${wave}`, async () => rt.cancelRequested());
                if (cancelled) {
                    state = { ...state, stopped: true, finished: true };
                    break;
                }

                if (state.sleepSeconds) {
                    // A durable pause: the instance sleeps without holding a
                    // request open, and wakes up here even after a restart.
                    await rt.setTask({ phase: 'waiting', waitUntil: Date.now() + state.sleepSeconds * 1000 });
                    await step.sleep(`pause-${wave}`, state.sleepSeconds * 1000);
                    state = { ...state, sleepSeconds: 0 };
                }

                const current = state;
                // Not retried: a wave posts messages, and a retry would post
                // them twice. A bot's own failure is already posted as a reply.
                state = await step.do(`wave-${wave}`, { retries: { limit: 0, delay: 0 }, timeout: '30 minutes' }, async () => {
                    // Progress writes are awaited before the step ends: a
                    // promise still pending when it returns is reported by the
                    // runtime as hung code.
                    const writes: Promise<void>[] = [];
                    const next = await iterate(rt.ctx, current, progress => {
                        writes.push(rt.setTask({
                            phase: progress.phase,
                            step: progress.step,
                            totalSteps: progress.totalSteps,
                            bot: progress.bot || '',
                            progress: progress.progress
                        }));
                    });
                    await Promise.allSettled(writes);
                    return plain(next);
                });
            }

            const final = state;
            await step.do('finishing', async () => {
                await rt.setTask({ phase: 'finishing', progress: final.evaluation?.progress ?? 0 });
                return true;
            });
            const report = await step.do('report', bookkeeping, async () => plain(await finishRun(rt.ctx, final)));

            await step.do('done', async () => {
                await rt.setTask({
                    status: final.stopped ? 'stopped' : 'done',
                    phase: 'done',
                    progress: report.progress,
                    result: String(report.answer).slice(0, 600)
                });
                return true;
            });
            return { progress: report.progress };
        } catch (error) {
            await rt.setTask({ status: 'failed', error: String((error as Error)?.message || error).slice(0, 500) });
            throw error;
        }
    }
}
