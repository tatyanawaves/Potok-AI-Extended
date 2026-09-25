import { AISettings, BoardMember } from '../../types';
import { complete, isFatalProviderError } from '../llm';
import {
    RosterEntry, Plan, PlanStep, StepLog, Evaluation, FinalReport, OrchestrationProgress,
    planPrompt, parsePlan, evaluationPrompt, parseEvaluation, finalPrompt, parseFinal,
    renderPlan, renderReport, readySteps, inputsFor, appendStep,
    MAX_ORCHESTRATED_STEPS, MAX_PARALLEL_STEPS, MAX_RESUMES
} from '../orchestratorCore';
import { AgentStore } from './store';
import { runAndPostTurn, probeToolServer, toolServersOf, ToolPolicy, ToolApprover } from './turn';
import { fileNote } from './memory';

/**
 * An orchestrated task, as a sequence of resumable pieces:
 *
 *   startRun  → plan (posted to the channel)
 *   iterate   → one wave of steps, run in parallel, then a progress check
 *   finishRun → scored report (posted, and filed in memory)
 *
 * Everything between the pieces lives in RunState, which is plain JSON. In the
 * browser runOrchestration simply loops; in the worker each piece is a durable
 * Workflow step, so a task survives restarts and closed tabs.
 */

export interface TaskContext {
    store: AgentStore;
    settings: AISettings;
    boardId: string;
    channelId: string;
    channelName: string;
    bots: BoardMember[];
    task: string;
    maxSteps: number;
    /** Who started it; the orchestrator posts under their account. */
    author: { id: string, name: string };
    toolPolicy: ToolPolicy;
    approveTool?: ToolApprover;
}

export interface RunState {
    plan: Plan;
    roster: RosterEntry[];
    /** The plan's steps plus any the supervisor added. */
    steps: PlanStep[];
    /** Ids of steps attempted, whether or not they succeeded. */
    done: number[];
    log: StepLog[];
    evaluation: Evaluation | null;
    stopped: boolean;
    finished: boolean;
    /**
     * Seconds to pause before the next wave, when a bot is waiting on a slow
     * job. The server sleeps durably; the browser simply waits.
     */
    sleepSeconds?: number;
}

const bookkeeping = (settings: AISettings) => settings.memoryModel || undefined;

const post = (ctx: TaskContext, content: string) => ctx.store.postMessage({
    channelId: ctx.channelId,
    boardId: ctx.boardId,
    authorId: ctx.author.id,
    authorName: '🧭 Оркестратор',
    authorType: 'agent',
    content,
    isAgentReply: true
});

const stepLimit = (ctx: TaskContext) => Math.min(Math.max(ctx.maxSteps, 1), MAX_ORCHESTRATED_STEPS);

/** The team as the planner sees it: roles, and the tools each bot really has. */
const buildRoster = (ctx: TaskContext): Promise<RosterEntry[]> =>
    Promise.all(ctx.bots.map(async bot => {
        const tools: string[] = [];
        if (ctx.toolPolicy !== 'off') {
            for (const url of toolServersOf(bot)) {
                try {
                    tools.push(...(await probeToolServer(url, ctx.store)).map(t => t.name));
                } catch {
                    // An unreachable server simply contributes no tools.
                }
            }
        }
        return { name: bot.name, persona: bot.systemPrompt || '', tools };
    }));

export const startRun = async (ctx: TaskContext): Promise<RunState> => {
    const roster = await buildRoster(ctx);
    const planned = await complete({
        messages: [{ role: 'user', content: planPrompt(ctx.task, roster, stepLimit(ctx)) }],
        temperature: 0.3, json: true, model: bookkeeping(ctx.settings)
    }, ctx.settings);
    const plan = parsePlan(planned.content, ctx.task, roster, stepLimit(ctx));
    await post(ctx, renderPlan(plan));

    return { plan, roster, steps: plan.steps, done: [], log: [], evaluation: null, stopped: false, finished: false };
};

/**
 * Runs the next wave — every step whose inputs are ready, up to
 * MAX_PARALLEL_STEPS at once — then checks progress, unless the plan is
 * exhausted anyway (the final report scores it) or the check would decide
 * nothing. Returns the new state; `finished` says there is nothing more to do.
 */
export const iterate = async (
    ctx: TaskContext,
    state: RunState,
    onProgress?: (p: OrchestrationProgress) => void
): Promise<RunState> => {
    const limit = stepLimit(ctx);
    const done = new Set(state.done);
    const room = limit - state.log.length;
    const wave = room > 0 ? readySteps(state.steps, done, Math.min(MAX_PARALLEL_STEPS, room)) : [];

    if (wave.length === 0) return { ...state, finished: true };

    const totalSteps = Math.min(limit, state.steps.length);
    onProgress?.({
        phase: 'working',
        step: state.log.length + 1,
        totalSteps,
        bot: wave.map(s => s.bot).join(', '),
        progress: state.evaluation?.progress ?? 0
    });

    const byName = new Map(ctx.bots.map(b => [b.name, b]));
    const outcomes = await Promise.all(wave.map((step, i) => runAndPostTurn({
        store: ctx.store,
        agent: byName.get(step.bot)!,
        boardId: ctx.boardId,
        channelId: ctx.channelId,
        channelName: ctx.channelName,
        settings: ctx.settings,
        toolPolicy: ctx.toolPolicy,
        approveTool: ctx.approveTool,
        assignment: {
            goal: state.plan.goal,
            instruction: step.instruction,
            step: state.log.length + i + 1,
            totalSteps,
            inputs: inputsFor(step, state.log)
        }
    })));

    // A step that asked to wait goes back into the plan, to the same bot,
    // told what to check; it is not logged as a result yet.
    let steps = state.steps;
    let sleepSeconds = 0;
    const finishedHere: typeof wave = [];

    wave.forEach((step, i) => {
        const wait = outcomes[i].ok ? outcomes[i].result!.wait : undefined;
        if (wait && (step.resumes || 0) < MAX_RESUMES) {
            sleepSeconds = Math.max(sleepSeconds, wait.seconds);
            steps = steps.map(s => s.id === step.id ? {
                ...s,
                resumes: (s.resumes || 0) + 1,
                instruction: `${step.instruction.split('\n[ПРОДОЛЖЕНИЕ]')[0]}\n[ПРОДОЛЖЕНИЕ] Ты ставил паузу. Проверь: ${wait.note}`
            } : s);
        } else {
            finishedHere.push(step);
        }
    });

    const log = [...state.log, ...finishedHere.map(step => {
        const i = wave.indexOf(step);
        return {
            stepId: step.id,
            bot: step.bot,
            instruction: step.instruction,
            result: outcomes[i].ok ? outcomes[i].result!.reply : (outcomes[i].error || 'ошибка'),
            ok: outcomes[i].ok
        };
    })];
    finishedHere.forEach(s => done.add(s.id));

    let next: RunState = { ...state, steps, log, done: [...done], sleepSeconds };
    if (sleepSeconds > 0) return next;

    // A bad key or a missing model fails every later step the same way.
    if (outcomes.some(o => !o.ok && isFatalProviderError(o.error))) {
        return { ...next, stopped: true, finished: true };
    }

    const remaining = next.steps.filter(s => !done.has(s.id));
    if (remaining.length === 0 || log.length >= limit) return { ...next, finished: true };

    onProgress?.({ phase: 'checking', step: log.length, totalSteps, progress: state.evaluation?.progress ?? 0 });
    try {
        const checked = await complete({
            messages: [{ role: 'user', content: evaluationPrompt(next.plan, log, remaining, next.roster) }],
            // Room for the JSON and a redirect instruction; reasoning models
            // spend part of the budget before answering, and a cut-off JSON
            // meant no check at all.
            temperature: 0.1, json: true, maxTokens: 900, model: bookkeeping(ctx.settings)
        }, ctx.settings);
        const evaluation = parseEvaluation(checked.content, next.plan, next.roster);
        next = { ...next, evaluation };

        if (evaluation.done) return { ...next, finished: true };
        if (evaluation.next) next = { ...next, steps: appendStep(next.steps, evaluation.next, done) };
    } catch (error) {
        // Without a check the plan simply continues as written.
        console.warn('[Orchestrator] Check failed:', error);
    }
    return next;
};

export const finishRun = async (ctx: TaskContext, state: RunState): Promise<FinalReport> => {
    let report: FinalReport;
    try {
        const final = await complete({
            messages: [{ role: 'user', content: finalPrompt(state.plan, state.log) }],
            temperature: 0.3, json: true, maxTokens: 4000, model: bookkeeping(ctx.settings)
        }, ctx.settings);
        report = parseFinal(final.content, state.plan, state.evaluation, state.log);
    } catch {
        report = parseFinal(null, state.plan, state.evaluation, state.log);
    }

    await post(ctx, renderReport(report) + (state.stopped ? '\n(остановлено до завершения)' : ''));

    // The outcome is worth knowing later, in this channel or another one.
    await fileNote(ctx.store, ctx.settings, ctx.boardId, {
        text: `Задача «${ctx.task.slice(0, 120)}»: ${report.answer.slice(0, 300)} (выполнено на ${report.progress}%)`,
        author: 'orchestrator',
        channelId: ctx.channelId
    }).catch(() => { });

    return report;
};

export interface OrchestrationResult {
    state: RunState;
    report: FinalReport;
}

/** The whole run in one go — how the browser runs it. */
export const runOrchestration = async (
    ctx: TaskContext,
    options: { onProgress?: (p: OrchestrationProgress) => void, shouldStop?: () => boolean } = {}
): Promise<OrchestrationResult> => {
    const { onProgress, shouldStop } = options;
    onProgress?.({ phase: 'planning', step: 0, totalSteps: stepLimit(ctx), progress: 0 });

    let state = await startRun(ctx);
    while (!state.finished) {
        if (shouldStop?.()) { state = { ...state, stopped: true, finished: true }; break; }
        if (state.sleepSeconds) {
            // In the browser a pause is a timer; Stop still ends it at once.
            const until = Date.now() + state.sleepSeconds * 1000;
            while (Date.now() < until && !shouldStop?.()) await new Promise(r => setTimeout(r, 1000));
            state = { ...state, sleepSeconds: 0 };
            continue;
        }
        state = await iterate(ctx, state, onProgress);
    }

    onProgress?.({ phase: 'finishing', step: state.log.length, totalSteps: state.log.length, progress: state.evaluation?.progress ?? 0 });
    return { state, report: await finishRun(ctx, state) };
};
