import { describe, it, expect } from 'vitest';
import {
    parsePlan, parseEvaluation, parseFinal, matchBot, estimateOrchestrationRequests,
    renderReport, planPrompt, RosterEntry, Plan
} from '../services/orchestratorCore';

const roster: RosterEntry[] = [
    { name: 'Analyst', persona: 'Finds data', tools: ['get_time'] },
    { name: 'Critic', persona: 'Checks conclusions', tools: [] }
];

const plan: Plan = { goal: 'G', criteria: ['a', 'b'], steps: [{ id: 1, bot: 'Analyst', instruction: 'go', after: [] }] };

describe('matchBot', () => {
    it('matches names case-insensitively and with @', () => {
        expect(matchBot('@analyst', roster)).toBe('Analyst');
        expect(matchBot('Nobody', roster)).toBeNull();
    });
});

describe('planPrompt', () => {
    it('lists every bot with its tools', () => {
        const prompt = planPrompt('Do it', roster, 3);
        expect(prompt).toContain('Analyst: Finds data | tools: get_time');
        expect(prompt).toContain('Critic: Checks conclusions | no external tools');
        expect(prompt).toContain('At most 3 steps');
    });
});

describe('parsePlan', () => {
    it('keeps steps for real bots only, within the step limit', () => {
        const raw = JSON.stringify({
            goal: 'Goal', criteria: ['c1'],
            steps: [
                { bot: 'analyst', instruction: 'one' },
                { bot: 'Ghost', instruction: 'two' },
                { bot: 'Critic', instruction: '' },
                { bot: 'Critic', instruction: 'three' },
                { bot: 'Analyst', instruction: 'four' }
            ]
        });
        const parsed = parsePlan(raw, 'task', roster, 2);
        expect(parsed.steps.map(st => [st.id, st.bot, st.instruction])).toEqual([[1, 'Analyst', 'one'], [2, 'Critic', 'three']]);
        expect(parsed.criteria).toEqual(['c1']);
    });

    it('falls back to giving every bot the task', () => {
        const parsed = parsePlan('not json', 'task', roster, 5);
        expect(parsed.goal).toBe('task');
        expect(parsed.steps.map(s => s.bot)).toEqual(['Analyst', 'Critic']);
        expect(parsed.criteria.length).toBeGreaterThan(0);
    });

    it('reads JSON inside a code fence', () => {
        const parsed = parsePlan('```json\n{"goal":"X","criteria":["a"],"steps":[{"bot":"Critic","instruction":"do"}]}\n```', 't', roster, 4);
        expect(parsed.goal).toBe('X');
        expect(parsed.steps[0].bot).toBe('Critic');
    });
});

describe('parseEvaluation', () => {
    it('does not believe "done" unless every criterion is met', () => {
        const ev = parseEvaluation('{"progress": 80, "criteria_met": [true, false], "done": true}', plan, roster);
        expect(ev.done).toBe(false);
        expect(ev.progress).toBe(80);
    });

    it('clamps progress and reads a redirect', () => {
        const ev = parseEvaluation('{"progress": 180, "criteria_met": [true, true], "done": true, "next": {"bot": "critic", "instruction": "check"}}', plan, roster);
        expect(ev.progress).toBe(100);
        expect(ev.done).toBe(true);
        expect(ev.next).toEqual({ bot: 'Critic', instruction: 'check' });
    });

    it('ignores a redirect to an unknown bot', () => {
        expect(parseEvaluation('{"next": {"bot": "X", "instruction": "y"}}', plan, roster).next).toBeUndefined();
    });

    it('survives an unusable answer', () => {
        expect(parseEvaluation(null, plan, roster)).toMatchObject({ progress: 0, done: false, criteriaMet: [false, false] });
    });
});

describe('parseFinal', () => {
    const log = [{ stepId: 1, bot: 'Analyst', instruction: 'go', result: 'the data', ok: true }];

    it('reads answer, score and criteria', () => {
        const report = parseFinal('{"answer":"A","progress":75,"criteria":[{"met":true},{"met":false}]}', plan, null, log);
        expect(report).toEqual({ answer: 'A', progress: 75, criteria: [{ text: 'a', met: true }, { text: 'b', met: false }] });
    });

    it('falls back to the last good result and the last check', () => {
        const report = parseFinal(null, plan, { progress: 40, done: false, criteriaMet: [true, false], reason: '' }, log);
        expect(report.answer).toBe('the data');
        expect(report.progress).toBe(40);
        expect(report.criteria[0].met).toBe(true);
    });
});

describe('reporting', () => {
    it('shows the degree of completion and a checklist', () => {
        const text = renderReport({ answer: 'Done', progress: 90, criteria: [{ text: 'a', met: true }, { text: 'b', met: false }] });
        expect(text).toContain('Степень выполнения: 90%');
        expect(text).toContain('✓ a');
        expect(text).toContain('✗ b');
    });

    it('bounds the cost: plan + steps × (turn + check) + final', () => {
        expect(estimateOrchestrationRequests(4, 5)).toBe(1 + 4 * 6 + 1);
    });
});
