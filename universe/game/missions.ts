import { mulberry32 } from '../mandelbrot';
import type { EnemyKind } from './models';

export type Objective =
    | { type: 'kill'; enemy: EnemyKind; count: number; done: number }
    | { type: 'reach'; body: string; withinKm: number; done: number }
    | { type: 'race'; body: string; seconds: number; withinKm: number; done: number };

export interface Mission {
    id: string;
    title: string;
    brief: string;
    /** Body the fight takes place near; enemies appear when the ship gets within `triggerKm` of it. */
    location: string;
    triggerKm: number;
    spawn: { kind: EnemyKind; count: number }[];
    objectives: Objective[];
    reward: number;
    state: 'available' | 'active' | 'done' | 'failed';
    spawned: boolean;
    startedAt: number;
    /** An errand given by someone met on the way: open at once, outside the main chain. */
    side?: boolean;
    /** Who gave it, for the panel. */
    giver?: string;
}

const ENEMY_RU: Record<EnemyKind, [string, string]> = {
    drone: ['дрон', 'дронов'],
    fighter: ['штурмовик', 'штурмовиков'],
    crystal: ['кристаллид', 'кристаллидов'],
    leviathan: ['левиафан', 'левиафанов'],
    interceptor: ['перехватчик', 'перехватчиков'],
    gunship: ['канонерку', 'канонерок'],
    hive: ['улей', 'ульев'],
};

export function mission(id: string, title: string, brief: string, location: string, spawn: Mission['spawn'], objectives: Objective[], reward: number): Mission {
    return { id, title, brief, location, triggerKm: 40_000, spawn, objectives, reward, state: 'available', spawned: false, startedAt: 0 };
}

export const kill = (enemy: EnemyKind, count: number): Objective => ({ type: 'kill', enemy, count, done: 0 });
export const reach = (body: string, withinKm: number): Objective => ({ type: 'reach', body, withinKm, done: 0 });

export function solarMissions(): Mission[] {
    return [
        mission('patrol', 'Патруль на орбите', 'Неизвестные дроны сканируют станции на орбите Земли. Уничтожьте их.',
            'Земля', [{ kind: 'drone', count: 4 }], [kill('drone', 4)], 300),
        mission('courier', 'Курьер на Марс', 'Срочный груз для колонии: долетите от Земли до Марса за 2 минуты.',
            'Марс', [], [{ type: 'race', body: 'Марс', seconds: 120, withinKm: 30_000, done: 0 }], 400),
        mission('moon-scan', 'Разведка Луны', 'Пройдите низко над Луной и затем проверьте Венеру.',
            'Луна', [], [reach('Луна', 3000), reach('Венера', 30_000)], 350),
        mission('pirates', 'Пираты у Фобоса', 'Пиратская база прячется за Фобосом. Разбейте её штурмовики.',
            'Фобос', [{ kind: 'fighter', count: 3 }, { kind: 'drone', count: 2 }], [kill('fighter', 3)], 700),
        mission('swarm', 'Рой у Европы', 'Подо льдом Европы проснулись кристаллиды. Они таранят всё, что движется.',
            'Европа', [{ kind: 'crystal', count: 10 }], [kill('crystal', 10)], 600),
        mission('leviathan', 'Левиафан Титана', 'В метановых облаках Титана замечено гигантское существо. Охота начинается.',
            'Титан', [{ kind: 'leviathan', count: 1 }, { kind: 'crystal', count: 4 }], [kill('leviathan', 1)], 2000),
    ];
}

/** Missions for a generated system, placed around its planets. */
export function generatedMissions(planets: string[], seed: number): Mission[] {
    const rng = mulberry32(seed ^ 0x6a55);
    const pick = () => planets[Math.floor(rng() * planets.length)];
    const list: Mission[] = [];
    if (!planets.length) return list;
    const a = pick(), b = pick(), c = planets[planets.length - 1];
    list.push(mission('g-patrol', `Зачистка у ${a}`, 'Дроны неизвестного происхождения захватили орбиту.', a,
        [{ kind: 'drone', count: 3 + Math.floor(rng() * 3) }], [kill('drone', 3)], 300));
    list.push(mission('g-swarm', `Рой у ${b}`, 'Кристаллиды роятся у планеты. Не дайте им вас протаранить.', b,
        [{ kind: 'crystal', count: 8 }], [kill('crystal', 8)], 500));
    list.push(mission('g-pirates', `Пиратский рейд: ${pick()}`, 'Перехватите пиратское звено.', planets[Math.floor(rng() * planets.length)],
        [{ kind: 'fighter', count: 3 }], [kill('fighter', 3)], 700));
    list.push(mission('g-leviathan', `Чудовище у ${c}`, 'У края системы охотится левиафан.', c,
        [{ kind: 'leviathan', count: 1 }], [kill('leviathan', 1)], 2000));
    list.push(mission('g-tour', 'Облёт системы', 'Проверьте первую и последнюю планеты.', planets[0],
        [], [reach(planets[0], 20_000), reach(c, 50_000)], 300));
    for (const m of list) m.location = m.location ?? planets[0];
    return list;
}

export function objectiveText(o: Objective, now = 0, startedAt = 0): string {
    switch (o.type) {
        case 'kill': {
            const [one, many] = ENEMY_RU[o.enemy];
            return `Уничтожить ${o.count === 1 ? one : many}: ${o.done}/${o.count}`;
        }
        case 'reach':
            return `${o.done ? '✓' : '◇'} Долететь до: ${o.body} (≤ ${o.withinKm.toLocaleString('ru-RU')} км)`;
        case 'race': {
            const left = Math.max(0, o.seconds - (now - startedAt));
            return `${o.done ? '✓' : '⏱'} ${o.body} за ${o.seconds} с — осталось ${left.toFixed(0)} с`;
        }
    }
}

const objectiveDone = (o: Objective) => (o.type === 'kill' ? o.done >= o.count : o.done > 0);

export class MissionLog {
    readonly missions: Mission[];
    active: Mission | null = null;
    onComplete?: (m: Mission) => void;
    onFail?: (m: Mission) => void;

    constructor(missions: Mission[]) {
        this.missions = missions;
    }

    /** Missions open one after another: each needs the one before it done. */
    unlocked(m: Mission): boolean {
        if (m.side) return true;
        const chain = this.missions.filter(x => !x.side);
        const i = chain.indexOf(m);
        return i <= 0 || chain[i - 1].state === 'done';
    }

    /** Take on an errand from a creature: added to the log and made the active mission. */
    addSide(m: Mission, now: number): Mission {
        m.side = true;
        let id = m.id, k = 2;
        while (this.missions.some(x => x.id === id)) id = `${m.id}-${k++}`;
        m.id = id;
        this.missions.push(m);
        this.accept(id, now);
        return m;
    }

    /** Returns false if the mission is still locked. */
    accept(id: string, now: number): boolean {
        const m = this.missions.find(x => x.id === id);
        if (!m || m.state === 'done' || !this.unlocked(m)) return false;
        if (this.active && this.active !== m && this.active.state === 'active') this.active.state = 'available';
        m.state = 'active';
        m.spawned = false;
        m.startedAt = now;
        for (const o of m.objectives) o.done = 0;
        this.active = m;
        return true;
    }

    /** The next objective still open: reach/race objectives are done in order. */
    current(): Objective | null {
        return this.active?.objectives.find(o => !objectiveDone(o)) ?? null;
    }

    kill(kind: EnemyKind) {
        const m = this.active;
        if (!m || m.state !== 'active') return;
        for (const o of m.objectives) if (o.type === 'kill' && o.enemy === kind && o.done < o.count) { o.done++; break; }
        this.check();
    }

    /** Called with the distance (km) from the ship to each body's surface that matters right now. */
    proximity(distanceKm: (body: string) => number, now: number) {
        const m = this.active;
        if (!m || m.state !== 'active') return;
        const o = this.current();
        if (o && (o.type === 'reach' || o.type === 'race') && distanceKm(o.body) <= o.withinKm) o.done = 1;
        if (o?.type === 'race' && !o.done && now - m.startedAt > o.seconds) {
            m.state = 'failed';
            this.onFail?.(m);
            return;
        }
        this.check();
    }

    private check() {
        const m = this.active;
        if (m && m.state === 'active' && m.objectives.every(objectiveDone)) {
            m.state = 'done';
            this.onComplete?.(m);
        }
    }
}
