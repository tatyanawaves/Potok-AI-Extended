import { describe, expect, it } from 'vitest';
import {
    AU_KM, blackbodyRGB, EARTH_MARS_GAP_KM, equilibriumTemperature, keplerPeriodDays, mainSequence, mutualHillRadius, ORBIT_SCALE,
    orbitalPosition, planckStarCoreRadiusM, planetRadiusFromMass, schwarzschildRadiusKm, SHIP_CRUISE_KM_S, solveKepler,
} from '../universe/physics';
import { cosmicWeb, generateSystem, kroupaMass, mandelbrot, mulberry32 } from '../universe/mandelbrot';
import { SOLAR_SYSTEM } from '../universe/solarSystem';

describe('scale of the star-system view', () => {
    it('crosses the drawn Earth–Mars orbital gap in 12 seconds', () => {
        expect((EARTH_MARS_GAP_KM * ORBIT_SCALE) / SHIP_CRUISE_KM_S).toBeCloseTo(12, 6);
        expect(EARTH_MARS_GAP_KM / 1e6).toBeCloseTo(78.3, 1);
    });
});

describe('Kepler', () => {
    it('solves Kepler’s equation', () => {
        for (const e of [0, 0.2, 0.7, 0.95]) {
            for (const M of [0.1, 1, 3, -2]) {
                const E = solveKepler(M, e);
                const back = E - e * Math.sin(E);
                expect(Math.cos(back)).toBeCloseTo(Math.cos(M), 9);
                expect(Math.sin(back)).toBeCloseTo(Math.sin(M), 9);
            }
        }
    });

    it('gives a year for 1 AU around the Sun and 1.88 years for Mars', () => {
        expect(keplerPeriodDays(AU_KM, 1)).toBeCloseTo(365.25, 0);
        const mars = SOLAR_SYSTEM.find(b => b.name === 'Марс')!;
        expect(mars.periodDays / 365.25).toBeCloseTo(1.88, 2);
    });

    it('keeps a planet between perihelion and aphelion', () => {
        const earth = SOLAR_SYSTEM.find(b => b.name === 'Земля')!;
        const el = { a: earth.aKm, e: earth.e, i: earth.i, node: earth.node, peri: earth.peri, M0: earth.M0, period: earth.periodDays };
        for (let t = 0; t < 400; t += 17) {
            const r = Math.hypot(...orbitalPosition(el, t));
            expect(r).toBeGreaterThanOrEqual(earth.aKm * (1 - earth.e) - 1);
            expect(r).toBeLessThanOrEqual(earth.aKm * (1 + earth.e) + 1);
        }
    });
});

describe('stars and planets', () => {
    it('reproduces the Sun and the Earth', () => {
        const sun = mainSequence(1);
        expect(sun.L).toBeCloseTo(1);
        expect(sun.T).toBeCloseTo(5772, 0);
        expect(equilibriumTemperature(1, 1, 0.306)).toBeCloseTo(254, 0);
        expect(planetRadiusFromMass(1)).toBeCloseTo(1, 1);
    });

    it('colours hot stars blue and cool stars red', () => {
        const [r1, , b1] = blackbodyRGB(3000);
        const [r2, , b2] = blackbodyRGB(20_000);
        expect(r1).toBeGreaterThan(b1);
        expect(b2).toBeGreaterThan(r2);
    });
});

describe('black holes', () => {
    it('has r_s ≈ 2.95 km per solar mass and a Planck-scale quantum core', () => {
        expect(schwarzschildRadiusKm(1)).toBeCloseTo(2.953, 2);
        const core = planckStarCoreRadiusM(4.297e6);
        expect(core).toBeGreaterThan(1e-22);
        expect(core).toBeLessThan(1e-18);
    });
});

describe('Mandelbrot generation', () => {
    it('knows the set', () => {
        expect(mandelbrot(0, 0).escaped).toBe(false);
        expect(mandelbrot(-1, 0).escaped).toBe(false);
        expect(mandelbrot(1, 1).escaped).toBe(true);
    });

    it('is deterministic and keeps generated systems dynamically stable', () => {
        const a = generateSystem(424242, 0.9), b = generateSystem(424242, 0.9);
        expect(a).toEqual(b);
        for (let seed = 1; seed < 60; seed++) {
            const s = generateSystem(seed * 7919, 0.3 + (seed % 10) * 0.2);
            expect(s.planets.length).toBeGreaterThanOrEqual(2);
            expect(s.planets.length).toBeLessThanOrEqual(10);
            for (let k = 1; k < s.planets.length; k++) {
                const p = s.planets[k - 1], q = s.planets[k];
                expect(q.aAU).toBeGreaterThan(p.aAU);
                expect(q.aAU - p.aAU).toBeGreaterThanOrEqual(0.999 * 10 * mutualHillRadius(p.aAU, q.aAU, p.massEarth, q.massEarth, s.starMass));
            }
        }
    });

    it('draws stellar masses mostly below the Sun, as the IMF says', () => {
        const rng = mulberry32(1);
        const masses = Array.from({ length: 5000 }, () => kroupaMass(rng));
        const small = masses.filter(m => m < 0.5).length / masses.length;
        expect(small).toBeGreaterThan(0.6);
        expect(Math.min(...masses)).toBeGreaterThanOrEqual(0.08);
    });

    it('puts cosmic-web galaxies inside the sampled cube', () => {
        const web = cosmicWeb(500, 3);
        expect(web.count).toBe(500);
        for (const v of web.positions) expect(Math.abs(v)).toBeLessThan(1.1);
    });
});
