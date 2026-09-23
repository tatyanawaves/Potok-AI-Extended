import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { segmentHits } from '../universe/game/combat';
import { generatedMissions, MissionLog, objectiveText, solarMissions } from '../universe/game/missions';

describe('projectile hits', () => {
    it('catches a fast bolt that jumps over its target in one step', () => {
        const a = new THREE.Vector3(-10, 0, 0), b = new THREE.Vector3(10, 0, 0);
        expect(segmentHits(a, b, new THREE.Vector3(0, 0.05, 0), 0.1)).toBe(true);
        expect(segmentHits(a, b, new THREE.Vector3(0, 0.5, 0), 0.1)).toBe(false);
        expect(segmentHits(a, b, new THREE.Vector3(12, 0, 0), 0.1)).toBe(false);
    });
});

describe('missions', () => {
    it('completes a kill mission and pays out once', () => {
        const log = new MissionLog(solarMissions());
        let paid = 0;
        log.onComplete = m => { paid += m.reward; };
        log.accept('patrol', 0);
        for (let i = 0; i < 3; i++) log.kill('drone');
        log.kill('crystal'); // the wrong kind does not count
        expect(log.active!.state).toBe('active');
        log.kill('drone');
        expect(log.active!.state).toBe('done');
        log.kill('drone');
        expect(paid).toBe(300);
    });

    it('does reach objectives in order', () => {
        const log = new MissionLog(solarMissions());
        log.accept('moon-scan', 0);
        const dist: Record<string, number> = { 'Луна': 1e6, 'Венера': 100 };
        log.proximity(n => dist[n], 1);
        expect(log.active!.objectives.map(o => o.done)).toEqual([0, 0]);
        dist['Луна'] = 2000;
        log.proximity(n => dist[n], 2);
        log.proximity(n => dist[n], 3);
        expect(log.active!.state).toBe('done');
    });

    it('fails a race that runs out of time', () => {
        const log = new MissionLog(solarMissions());
        let failed = false;
        log.onFail = () => { failed = true; };
        log.accept('courier', 10);
        log.proximity(() => 1e9, 10 + 121);
        expect(failed).toBe(true);
        expect(objectiveText(log.active!.objectives[0], 131, 10)).toContain('осталось 0');
    });

    it('builds missions for a generated system around its planets', () => {
        const planets = ['A b', 'A c', 'A d'];
        const ms = generatedMissions(planets, 42);
        expect(ms.length).toBeGreaterThan(3);
        for (const m of ms) expect(planets).toContain(m.location);
    });
});
