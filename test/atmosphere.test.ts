import { describe, expect, it } from 'vitest';
import { earthAtmosphere, scatter, sunTransmittance, surfaceFor } from '../universe/atmosphere';

const up: [number, number, number] = [0, 1, 0];
const sunAt = (elevDeg: number): [number, number, number] => {
    const e = (elevDeg * Math.PI) / 180;
    return [Math.cos(e), Math.sin(e), 0];
};
const h = (m: number) => [0, 1 + m / 6.371e6, 0] as [number, number, number];

describe('atmospheric scattering', () => {
    it('makes a blue sky at noon on Earth', () => {
        const [r, g, b] = scatter(earthAtmosphere(), h(10), up, sunAt(60));
        expect(b).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(r);
    });

    it('reddens the sunlight at sunset', () => {
        const a = earthAtmosphere();
        const noon = sunTransmittance(a, 1e-6, sunAt(80));
        const dusk = sunTransmittance(a, 1e-6, sunAt(2));
        expect(noon[2] / noon[0]).toBeGreaterThan(0.6);
        expect(dusk[2] / dusk[0]).toBeLessThan(0.3);
    });

    it('goes dark at night and black in space', () => {
        const a = earthAtmosphere();
        const night = scatter(a, h(10), up, sunAt(-30));
        expect(Math.max(...night)).toBeLessThan(1e-3);
        expect(scatter(a, [0, 3, 0], up, sunAt(60))).toEqual([0, 0, 0]);
    });

    it('gives Mars a warm day sky and airless moons none', () => {
        const mars = surfaceFor('Марс', 'desert', 3389.5, 3.71);
        const [r, , b] = scatter(mars.atmosphere!, [0, 1.00001, 0], [-0.6, 0.8, 0], sunAt(50));
        // ...while right around the Sun the dust scatters blue: the Martian blue glow.
        const [r2, , b2] = scatter(mars.atmosphere!, [0, 1.00001, 0], [Math.cos(0.87), Math.sin(0.87), 0], sunAt(50));
        expect(b2 / r2).toBeGreaterThan(b / r);
        expect(r).toBeGreaterThan(b);
        // The horizon away from the Sun is butterscotch too, not black.
        const [rh, , bh] = scatter(mars.atmosphere!, [0, 1.0006, 0], [-1, 0.02, 0], sunAt(50));
        expect(rh).toBeGreaterThan(0.2);
        expect(rh).toBeGreaterThan(bh);
        expect(surfaceFor('Луна', 'moon', 1737, 1.62).atmosphere).toBeNull();
    });
});
