import { describe, expect, it } from 'vitest';
import { effects, progress } from '../universe/game/progress';
import { memoryGreeting, REFUSE_MOOD, scriptedTurn } from '../universe/game/dialogue';
import { solarCreatures } from '../universe/game/creatures';
import { tidalTearRadiusRs } from '../universe/physics';

describe('upgrades bought with score', () => {
    it('costs score, raises the level, and stops at the maximum', () => {
        progress.reset();
        expect(progress.buy('hull')).toBe(false); // nothing to spend yet
        progress.data.score = 5000;
        expect(progress.buy('hull')).toBe(true);
        expect(progress.data.score).toBe(4750);
        expect(effects.maxHull).toBe(150);
        progress.buy('hull'); progress.buy('hull');
        expect(progress.level('hull')).toBe(3);
        expect(progress.buy('hull')).toBe(false);
        expect(progress.nextCost('hull')).toBeNull();
    });

    it('makes the ship faster and deadlier', () => {
        progress.reset();
        const base = { boost: effects.boost, fire: effects.fireInterval, dmg: effects.damage };
        progress.data.score = 10_000;
        progress.buy('turbo'); progress.buy('rate'); progress.buy('damage');
        expect(effects.boost).toBeGreaterThan(base.boost);
        expect(effects.fireInterval).toBeLessThan(base.fire);
        expect(effects.damage).toBeGreaterThan(base.dmg);
    });
});

describe('creature memory', () => {
    const [oira] = solarCreatures();

    it('greets a pilot met before by what it remembers', () => {
        const mem = { talks: 3, mood: 2, said: ['Рад встрече!'], errands: [{ title: 'Тишина для стаи', state: 'done' as const }] };
        const g = memoryGreeting(mem);
        expect(g).toContain('Тишина для стаи');
        expect(g).toContain('Рад встрече!');
        expect(scriptedTurn(oira, [], mem).line).toBe(g);
        // A first meeting starts with the creature's own greeting.
        expect(scriptedTurn(oira, [], { talks: 1, mood: 0, said: [], errands: [] }).line).toBe(oira.script.greet);
    });

    it('holds a grudge against a rude pilot', () => {
        expect(memoryGreeting({ talks: 2, mood: -1.5, said: [], errands: [] })).toMatch(/не слишком вежлив/);
        expect(REFUSE_MOOD).toBeLessThan(-1.5);
    });
});

describe('tides near a black hole', () => {
    it('shred a ship far outside a small hole, but only deep inside a supermassive one', () => {
        expect(tidalTearRadiusRs(10)).toBeGreaterThan(10);
        const sgrA = tidalTearRadiusRs(4.3e6);
        expect(sgrA).toBeLessThan(0.05);
        expect(sgrA).toBeGreaterThan(0.001);
    });
});
