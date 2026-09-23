// Single-scattering model of a planetary atmosphere (Rayleigh + Mie, after
// Nishita et al. 1993), shared by the GLSL sky and a CPU copy used for the
// ambient light and in tests. Lengths are in units of the planet radius so
// the same numbers work from the ground and from orbit without float32 loss.

import type { PlanetKind } from './mandelbrot';

export interface AtmosphereParams {
    /** Top of the atmosphere, in planet radii (1 = surface). */
    top: number;
    /** Rayleigh scattering coefficients at the surface, per planet radius. */
    betaR: [number, number, number];
    /** Mie (aerosol, dust) scattering coefficients at the surface, per planet radius. */
    betaM: [number, number, number];
    /** Scale heights, in planet radii. */
    hR: number;
    hM: number;
    /** Mie anisotropy g. */
    g: number;
    /** Tint of the strong forward-scattering peak (Mars dust scatters blue forward). */
    forwardTint: [number, number, number];
    /**
     * Isotropic multiple-scattering boost for the Mie term. Single scattering is
     * enough for clear air, but in a dusty or hazy atmosphere most skylight has
     * bounced several times; without this the sky away from the Sun goes black.
     */
    multi: number;
    /** Aerosol absorption, per planet radius (iron-oxide dust absorbs blue). */
    absorbM: [number, number, number];
    sunIntensity: number;
}

export interface SurfaceParams {
    radiusM: number;
    atmosphere: AtmosphereParams | null;
    /** Terrain relief amplitude, m. */
    relief: number;
    /** Sea level, m, or null for a dry world. */
    sea: number | null;
    craters: boolean;
    palette: 'earth' | 'mars' | 'moon' | 'ice' | 'lava' | 'venus' | 'desert' | 'titan';
    gravity: number;
}

const per = (radiusM: number, v: [number, number, number]): [number, number, number] =>
    [v[0] * radiusM, v[1] * radiusM, v[2] * radiusM];

/** Earth's measured coefficients (Bruneton & Neyret 2008), rescaled to planet radii. */
export function earthAtmosphere(radiusM = 6.371e6): AtmosphereParams {
    return {
        top: 1 + 100_000 / radiusM,
        betaR: per(radiusM, [5.8e-6, 13.5e-6, 33.1e-6]),
        betaM: per(radiusM, [21e-6, 21e-6, 21e-6]),
        hR: 8000 / radiusM,
        hM: 1200 / radiusM,
        g: 0.76,
        forwardTint: [1, 1, 1],
        multi: 0,
        absorbM: [0, 0, 0],
        sunIntensity: 22,
    };
}

/**
 * Surface and sky for a body, from its type. The real bodies of the Solar
 * System get their own numbers; generated planets follow their kind.
 */
export function surfaceFor(name: string, kind: PlanetKind | 'moon', radiusKm: number, gravity: number): SurfaceParams {
    const R = radiusKm * 1000;
    const base = { radiusM: R, gravity, craters: false, sea: null as number | null };
    switch (name) {
        case 'Земля':
            return { ...base, atmosphere: earthAtmosphere(R), relief: 2200, sea: 0, palette: 'earth' };
        case 'Марс':
            // Thin CO₂ and suspended dust: a butterscotch day sky and a blue sunset around the Sun.
            return {
                ...base, relief: 3200, palette: 'mars', craters: true,
                atmosphere: {
                    // CO₂ Rayleigh optical depth ≈ 0.004 in blue; dust optical depth ≈ 0.5, redder than blue.
                    top: 1 + 60_000 / R, betaR: per(R, [0.08e-6, 0.17e-6, 0.36e-6]), betaM: per(R, [5.2e-5, 4e-5, 2.8e-5]),
                    hR: 11_100 / R, hM: 11_000 / R, g: 0.65, forwardTint: [0.5, 0.75, 1.4], multi: 1.6, absorbM: per(R, [0.4e-5, 1.4e-5, 2.8e-5]), sunIntensity: 14,
                },
            };
        case 'Венера':
            return {
                ...base, relief: 1800, palette: 'venus',
                atmosphere: {
                    top: 1 + 90_000 / R, betaR: per(R, [1.2e-4, 1.6e-4, 2.4e-4]), betaM: per(R, [9e-5, 7e-5, 3e-5]),
                    hR: 15_900 / R, hM: 9000 / R, g: 0.7, forwardTint: [1, 0.85, 0.6], multi: 0.8, absorbM: per(R, [0.2e-5, 1e-5, 4e-5]), sunIntensity: 18,
                },
            };
        case 'Титан':
            return {
                ...base, relief: 900, sea: -60, palette: 'titan',
                atmosphere: {
                    top: 1 + 300_000 / R, betaR: per(R, [1e-6, 2e-6, 4e-6]), betaM: per(R, [1.4e-5, 0.9e-5, 0.35e-5]),
                    hR: 21_000 / R, hM: 40_000 / R, g: 0.7, forwardTint: [1, 0.8, 0.5], multi: 0.7, absorbM: per(R, [0.1e-5, 0.5e-5, 1.5e-5]), sunIntensity: 6,
                },
            };
    }
    switch (kind) {
        case 'earth': return { ...base, atmosphere: earthAtmosphere(R), relief: 2500, sea: 0, palette: 'earth' };
        case 'desert': return surfaceFor('Марс', 'desert', radiusKm, gravity);
        case 'venus': return surfaceFor('Венера', 'venus', radiusKm, gravity);
        case 'ice': return { ...base, atmosphere: null, relief: 1500, palette: 'ice', craters: true };
        case 'lava': return { ...base, atmosphere: null, relief: 1200, palette: 'lava' };
        case 'moon':
        case 'rocky':
        default:
            return { ...base, atmosphere: null, relief: 2500, palette: 'moon', craters: true };
    }
}

/** Can the ship land here? Gas and ice giants have no surface. */
export const landable = (kind: string) => kind !== 'gas' && kind !== 'ice-giant' && kind !== 'star';

// ---------------------------------------------------------------------------
// CPU reference of the shader's integrator
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function raySphere(ro: V3, rd: V3, r: number): [number, number] {
    const b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
    if (d < 0) return [1e9, -1e9];
    const s = Math.sqrt(d);
    return [-b - s, -b + s];
}

/**
 * Light scattered towards an observer at `ro` looking along `rd` (unit
 * vectors, planet radii, planet centred at the origin), with the Sun along
 * `sun`. Returns linear RGB radiance.
 */
export function scatter(a: AtmosphereParams, ro: V3, rd: V3, sun: V3, steps = 16, lightSteps = 8): V3 {
    const [t0, t1] = raySphere(ro, rd, a.top);
    if (t0 > t1 || t1 < 0) return [0, 0, 0];
    const ground = raySphere(ro, rd, 1);
    let tEnd = t1;
    if (ground[0] > 0) tEnd = Math.min(tEnd, ground[0]);
    const tStart = Math.max(t0, 0);
    const seg = (tEnd - tStart) / steps;
    const mu = dot(rd, sun);
    const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
    const g = a.g;
    const phaseM = (3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5))
        + a.multi / (4 * Math.PI);
    const forward = Math.pow(Math.max(mu, 0), 16);
    const sum: V3 = [0, 0, 0];
    let odR = 0, odM = 0;
    for (let i = 0; i < steps; i++) {
        const t = tStart + seg * (i + 0.5);
        const p: V3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
        const h = Math.hypot(...p) - 1;
        const dR = Math.exp(-h / a.hR) * seg, dM = Math.exp(-h / a.hM) * seg;
        odR += dR; odM += dM;
        const l = raySphere(p, sun, a.top);
        const segL = l[1] / lightSteps;
        let lR = 0, lM = 0, blocked = false;
        for (let j = 0; j < lightSteps; j++) {
            const tl = segL * (j + 0.5);
            const hl = Math.hypot(p[0] + sun[0] * tl, p[1] + sun[1] * tl, p[2] + sun[2] * tl) - 1;
            if (hl < 0) { blocked = true; break; }
            lR += Math.exp(-hl / a.hR) * segL;
            lM += Math.exp(-hl / a.hM) * segL;
        }
        if (blocked) continue;
        for (let k = 0; k < 3; k++) {
            const att = Math.exp(-(a.betaR[k] * (odR + lR) + (a.betaM[k] * 1.1 + a.absorbM[k]) * (odM + lM)));
            const tint = 1 + (a.forwardTint[k] - 1) * forward;
            sum[k] += att * (dR * a.betaR[k] * phaseR + dM * a.betaM[k] * phaseM * tint);
        }
    }
    return [sum[0] * a.sunIntensity, sum[1] * a.sunIntensity, sum[2] * a.sunIntensity];
}

/** Fraction of sunlight reaching the ground at height h (radii) with the Sun at `sun`. */
export function sunTransmittance(a: AtmosphereParams, h: number, sun: V3, steps = 12): V3 {
    const p: V3 = [0, 1 + h, 0];
    if (raySphere(p, sun, 1)[0] > 0) return [0, 0, 0];
    const l = raySphere(p, sun, a.top);
    const seg = l[1] / steps;
    let odR = 0, odM = 0;
    for (let j = 0; j < steps; j++) {
        const t = seg * (j + 0.5);
        const hl = Math.hypot(p[0] + sun[0] * t, p[1] + sun[1] * t, p[2] + sun[2] * t) - 1;
        odR += Math.exp(-hl / a.hR) * seg;
        odM += Math.exp(-hl / a.hM) * seg;
    }
    return [0, 1, 2].map(k => Math.exp(-(a.betaR[k] * odR + (a.betaM[k] * 1.1 + a.absorbM[k]) * odM))) as V3;
}
