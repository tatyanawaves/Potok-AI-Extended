import { AISettings, BoardMember } from '../types';
import { sendMessage } from './boards';
import { complete, isFatalProviderError } from './llm';
import { addNote } from './agentMemory';
import {
    runAndPostTurn, toolServersOf, probeToolServer, ToolPolicy, ToolApprover
} from './boardAgent';
import {
    RosterEntry, Plan, PlanStep, StepLog, Evaluation, FinalReport,
    planPrompt, parsePlan, evaluationPrompt, parseEvaluation, finalPrompt, parseFinal,
    renderPlan, renderReport, MAX_ORCHESTRATED_STEPS
} from './orchestratorCore';

export * from './orchestratorCore';

/**
 * An orchestrated meeting: plan, hand steps to bots, check progress after
 * each, finish with a scored result. The reasoning is in ./orchestratorCore.
 *
 * Runs in the browser of whoever started it, on their key, like every other
 * bot request here.
 */

export interface OrchestrationProgress {
    phase: 'planning' | 'working' | 'checking' | 'finishing';
    step: number;
    totalSteps: number;
    bot?: string;
    progress: number;
}

export interface OrchestrationOptions {
    boardId: string;
    channelId: string;
    channelName: string;
    bots: BoardMember[];
    task: string;
    maxSteps: number;
    settings: AISettings;
    /** Who started it; the orchestrator posts under their account. */
    author: { id: string, name: string };
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
    onProgress?: (progress: OrchestrationProgress) => void;
    shouldStop?: () => boolean;
}

export interface OrchestrationResult {
    plan: Plan;
    log: StepLog[];
    report: FinalReport;
    stopped: boolean;
}

/** The team as the planner sees it: roles, and the tools each bot really has. */
const buildRoster = async (bots: BoardMember[], settings: AISettings, policy: ToolPolicy): Promise<RosterEntry[]> =>
    Promise.all(bots.map(async bot => {
        const tools: string[] = [];
        if (policy !== 'off') {
            for (const url of toolServersOf(bot)) {
                try {
                    tools.push(...(await probeToolServer(url, settings)).map(t => t.name));
                } catch {
                    // An unreachable server simply contributes no tools.
                }
            }
        }
        return { name: bot.name, persona: bot.systemPrompt || '', tools };
    }));

export const runOrchestration = async (options: OrchestrationOptions): Promise<OrchestrationResult> => {
    const {
        boardId, channelId, channelName, bots, task, settings, author,
        toolPolicy = 'ask', approveTool, onProgress, shouldStop
    } = options;
    const maxSteps = Math.min(Math.max(options.maxSteps, 1), MAX_ORCHESTRATED_STEPS);
    const bookkeepingModel = settings.memoryModel || undefined;

    const post = (content: string) => sendMessage({
        channelId, boardId,
        authorId: author.id,
        authorName: '🧭 Оркестратор',
        authorType: 'agent',
        content,
        isAgentReply: true
    });

    onProgress?.({ phase: 'planning', step: 0, totalSteps: maxSteps, progress: 0 });
    const roster = await buildRoster(bots, settings, toolPolicy);

    const planned = await complete({
        messages: [{ role: 'user', content: planPrompt(task, roster, maxSteps) }],
        temperature: 0.3, json: true, model: bookkeepingModel
    }, settings);
    const plan = parsePlan(planned.content, task, roster, maxSteps);
    await post(renderPlan(plan));

    const byName = new Map(bots.map(b => [b.name, b]));
    const queue: PlanStep[] = [...plan.steps];
    const log: StepLog[] = [];
    let evaluation: Evaluation | null = null;
    let stopped = false;

    while (queue.length > 0 && log.length < maxSteps) {
        if (shouldStop?.()) { stopped = true; break; }

        const step = queue.shift()!;
        const bot = byName.get(step.bot)!;
        const stepNumber = log.length + 1;
        const totalSteps = Math.min(maxSteps, log.length + 1 + queue.length);

        onProgress?.({ phase: 'working', step: stepNumber, totalSteps, bot: bot.name, progress: evaluation?.progress ?? 0 });

        const outcome = await runAndPostTurn({
            agent: bot, boardId, channelId, channelName, settings,
            assignment: { goal: plan.goal, instruction: step.instruction, step: stepNumber, totalSteps },
            toolPolicy, approveTool
        });

        log.push({
            bot: bot.name,
            instruction: step.instruction,
            result: outcome.ok ? outcome.result!.reply : (outcome.error || 'ошибка'),
            ok: outcome.ok
        });

        if (!outcome.ok && isFatalProviderError(outcome.error)) { stopped = true; break; }
        if (shouldStop?.()) { stopped = true; break; }

        // The last planned step needs no check of its own: the final report
        // scores the result anyway, and the call would be spent for nothing.
        if (queue.length === 0 && log.length >= plan.steps.length) break;
        if (log.length >= maxSteps) break;

        onProgress?.({ phase: 'checking', step: stepNumber, totalSteps, progress: evaluation?.progress ?? 0 });
        try {
            const checked = await complete({
                messages: [{ role: 'user', content: evaluationPrompt(plan, log, queue, roster) }],
                temperature: 0.1, json: true, maxTokens: 400, model: bookkeepingModel
            }, settings);
            evaluation = parseEvaluation(checked.content, plan, roster);
        } catch (error) {
            // Without a check the plan simply continues as written.
            console.warn('[Orchestrator] Check failed:', error);
            continue;
        }

        if (evaluation.done) break;
        if (evaluation.next) {
            // The supervisor redirects: its step replaces the one planned next.
            queue.shift();
            queue.unshift(evaluation.next);
        }
    }

    onProgress?.({ phase: 'finishing', step: log.length, totalSteps: log.length, progress: evaluation?.progress ?? 0 });

    let report: FinalReport;
    try {
        const final = await complete({
            messages: [{ role: 'user', content: finalPrompt(plan, log) }],
            temperature: 0.3, json: true, maxTokens: 1200, model: bookkeepingModel
        }, settings);
        report = parseFinal(final.content, plan, evaluation, log);
    } catch (error) {
        report = parseFinal(null, plan, evaluation, log);
    }

    await post(renderReport(report) + (stopped ? '\n(остановлено до завершения)' : ''));

    // The outcome is worth knowing later, in this channel or another one.
    await addNote(boardId, {
        text: `Задача «${task.slice(0, 120)}»: ${report.answer.slice(0, 300)} (выполнено на ${report.progress}%)`,
        author: 'orchestrator',
        channelId
    }).catch(() => { });

    return { plan, log, report, stopped };
};
