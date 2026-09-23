/**
 * The orchestrator's reasoning, without the I/O: the prompts it sends and how
 * their answers are read. See ./orchestrator for the run itself.
 *
 * Pattern: plan-and-execute with a supervisor. One call plans the work — a
 * goal, checkable success criteria, and steps assigned to the bots best suited
 * to them. After each step a short check scores progress against the criteria
 * and may redirect the next step or finish early. A last call writes the
 * result with the degree of completion.
 *
 * Compared with bots taking turns in a circle, the orchestrator decides who
 * works next and when the task is done, so a run does no more turns than the
 * task needs and ends with an explicit, scored answer.
 */

export interface RosterEntry {
    name: string;
    persona: string;
    tools: string[];
}

export interface PlanStep {
    bot: string;
    instruction: string;
}

export interface Plan {
    goal: string;
    criteria: string[];
    steps: PlanStep[];
}

export interface Evaluation {
    /** 0–100. */
    progress: number;
    done: boolean;
    criteriaMet: boolean[];
    next?: PlanStep;
    reason: string;
}

export interface StepLog {
    bot: string;
    instruction: string;
    result: string;
    ok: boolean;
}

export interface FinalReport {
    answer: string;
    progress: number;
    criteria: Array<{ text: string, met: boolean }>;
}

export const MAX_ORCHESTRATED_STEPS = 8;

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const parseObject = (raw: string | null | undefined): any => {
    if (!raw) return null;
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const match = (fenced ? fenced[1] : raw).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
};

const clampPercent = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};

/** Case-insensitive match of a name the model wrote to a real bot. */
export const matchBot = (name: unknown, roster: RosterEntry[]): string | null => {
    const wanted = String(name || '').replace(/^@/, '').trim().toLowerCase();
    return roster.find(r => r.name.toLowerCase() === wanted)?.name || null;
};

const rosterText = (roster: RosterEntry[]) => roster.map(r =>
    `- ${r.name}: ${clip(r.persona.replace(/\s+/g, ' '), 220) || 'general assistant'}${r.tools.length ? ` | tools: ${r.tools.slice(0, 15).join(', ')}` : ' | no external tools'}`
).join('\n');

const logText = (log: StepLog[]) => log.length
    ? log.map((s, i) => `${i + 1}. ${s.bot} — ${s.instruction}\n   RESULT: ${s.ok ? clip(s.result.replace(/\s+/g, ' '), 700) : 'FAILED: ' + clip(s.result, 200)}`).join('\n')
    : '(nothing done yet)';

export const planPrompt = (task: string, roster: RosterEntry[], maxSteps: number): string => `ORCHESTRATOR_PLAN
You coordinate a team of AI bots to complete a task. Plan the work.

TASK: ${task}

TEAM:
${rosterText(roster)}

Rules:
- 2-4 success criteria that can be checked from the bots' answers.
- At most ${maxSteps} steps. Assign each step to the bot whose role and tools fit it best; a bot may get several steps.
- Steps that need external data go to a bot with the matching tools.
- Each instruction is concrete and self-contained; the last step produces the final deliverable.
- Write in the language of the task.
Respond ONLY in JSON: {"goal": "...", "criteria": ["..."], "steps": [{"bot": "Name", "instruction": "..."}]}`;

/**
 * Reads a plan, keeping only steps assigned to real bots. When the model's
 * answer is unusable, every bot gets the task once — a plain plan is better
 * than no run.
 */
export const parsePlan = (raw: string | null, task: string, roster: RosterEntry[], maxSteps: number): Plan => {
    const data = parseObject(raw);
    const steps: PlanStep[] = Array.isArray(data?.steps)
        ? data.steps
            .map((s: any) => ({ bot: matchBot(s?.bot, roster), instruction: String(s?.instruction || '').trim() }))
            .filter((s: any): s is PlanStep => Boolean(s.bot && s.instruction))
            .slice(0, maxSteps)
        : [];

    const criteria: string[] = Array.isArray(data?.criteria)
        ? data.criteria.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 4)
        : [];

    return {
        goal: String(data?.goal || task).trim(),
        criteria: criteria.length ? criteria : ['Задача выполнена полностью, результат конкретный'],
        steps: steps.length
            ? steps
            : roster.slice(0, maxSteps).map(r => ({ bot: r.name, instruction: task }))
    };
};

export const evaluationPrompt = (plan: Plan, log: StepLog[], remaining: PlanStep[], roster: RosterEntry[]): string => `ORCHESTRATOR_EVAL
You supervise a team of AI bots. Judge progress on the goal from the work so far.

GOAL: ${plan.goal}
CRITERIA:
${plan.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

DONE SO FAR:
${logText(log)}

PLANNED NEXT: ${remaining.length ? remaining.map(s => `${s.bot}: ${s.instruction}`).join(' | ') : '(nothing)'}
TEAM: ${roster.map(r => r.name).join(', ')}

Decide: progress 0-100; which criteria are met; done=true only if every criterion is met.
If the planned next step is wrong or missing and work remains, give "next" (bot + instruction); otherwise null.
Respond ONLY in JSON: {"progress": 0, "criteria_met": [true], "done": false, "next": null, "reason": "one sentence"}`;

export const parseEvaluation = (raw: string | null, plan: Plan, roster: RosterEntry[]): Evaluation => {
    const data = parseObject(raw);
    if (!data) return { progress: 0, done: false, criteriaMet: plan.criteria.map(() => false), reason: 'нет оценки' };

    const met: boolean[] = plan.criteria.map((_, i) => Boolean(Array.isArray(data.criteria_met) && data.criteria_met[i]));
    const nextBot = matchBot(data.next?.bot, roster);
    const nextInstruction = String(data.next?.instruction || '').trim();

    return {
        progress: clampPercent(data.progress),
        // "Done" is only believed when the criteria back it up.
        done: Boolean(data.done) && met.every(Boolean),
        criteriaMet: met,
        next: nextBot && nextInstruction ? { bot: nextBot, instruction: nextInstruction } : undefined,
        reason: String(data.reason || '').trim()
    };
};

export const finalPrompt = (plan: Plan, log: StepLog[]): string => `ORCHESTRATOR_FINAL
The team worked on a goal. Write the final result for the person who asked.

GOAL: ${plan.goal}
CRITERIA:
${plan.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

WORK DONE:
${logText(log)}

Write "answer": the deliverable itself (not a description of the process), complete and ready to use, in the language of the goal, under 250 words.
Score "progress" 0-100 honestly: how fully the goal is achieved. For each criterion, say whether it is met.
Respond ONLY in JSON: {"answer": "...", "progress": 0, "criteria": [{"text": "...", "met": true}]}`;

export const parseFinal = (raw: string | null, plan: Plan, fallback: Evaluation | null, log: StepLog[]): FinalReport => {
    const data = parseObject(raw);
    const lastGood = [...log].reverse().find(s => s.ok)?.result || '';

    const criteria = plan.criteria.map((text, i) => {
        const given = Array.isArray(data?.criteria) ? data.criteria[i] : undefined;
        return { text, met: given ? Boolean(given.met) : Boolean(fallback?.criteriaMet[i]) };
    });

    return {
        answer: String(data?.answer || '').trim() || lastGood || 'Итог не получен.',
        progress: data && data.progress !== undefined ? clampPercent(data.progress) : (fallback?.progress ?? 0),
        criteria
    };
};

/** The most model requests an orchestrated run can make, shown before it starts. */
export const estimateOrchestrationRequests = (maxSteps: number, requestsPerTurn: number): number =>
    1 + maxSteps * (requestsPerTurn + 1) + 1;

export const renderReport = (report: FinalReport): string => [
    `✅ Итог`,
    report.answer,
    '',
    `Степень выполнения: ${report.progress}%`,
    ...report.criteria.map(c => `${c.met ? '✓' : '✗'} ${c.text}`)
].join('\n');

export const renderPlan = (plan: Plan): string => [
    `🧭 План: ${plan.goal}`,
    `Критерии: ${plan.criteria.join('; ')}`,
    ...plan.steps.map((s, i) => `${i + 1}. @${s.bot} — ${s.instruction}`)
].join('\n');
