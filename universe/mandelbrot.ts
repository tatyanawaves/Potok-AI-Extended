// Procedural generation driven by the Mandelbrot family of fractals.
//
//  • The cosmic web is the shell of the Mandelbulb (the 3D power-8 Mandelbrot
//    set): galaxies sit where the distance estimate is close to zero, which
//    gives sheets, filaments and empty voids, like the observed large-scale
//    structure, whose correlation dimension is also ≈ 2.
//  • A galaxy's Hubble type comes from the escape time of its position in the
//    2D Mandelbrot set; irregular galaxies are shaped like Julia sets.
//  • A planetary system is read off the orbit z → z² + c of a point c near the
//    boundary of the set: how long it takes to escape gives the number of
//    planets, |z| the spacing of their orbits, arg z their phase.

import {
    AU_KM, EARTH_PER_SUN_MASS, equilibriumTemperature, frostLine, habitableZone, keplerPeriodDays,
    mainSequence, mutualHillRadius, planetRadiusFromMass, StarProps,
} from './physics';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

export function hash32(...values: number[]): number {
    let h = 0x811c9dc5;
    for (const v of values) {
        h ^= v | 0;
        h = Math.imul(h, 0x01000193);
        h ^= h >>> 13;
        h = Math.imul(h, 0x5bd1e995);
        h ^= h >>> 15;
    }
    return h >>> 0;
}

export function gaussian(rng: () => number): number {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------------------------------------------------------------------
// The fractals
// ---------------------------------------------------------------------------

export interface MandelbrotResult {
    escaped: boolean;
    iterations: number;
    /** Continuous escape time, n + 1 − log₂ log|z|. */
    smooth: number;
    /** The visited points z₁, z₂, … as [x, y] pairs. */
    orbit: [number, number][];
}

export function mandelbrot(cx: number, cy: number, maxIter = 64): MandelbrotResult {
    let x = 0, y = 0;
    const orbit: [number, number][] = [];
    for (let n = 0; n < maxIter; n++) {
        const xn = x * x - y * y + cx;
        y = 2 * x * y + cy;
        x = xn;
        orbit.push([x, y]);
        const r2 = x * x + y * y;
        if (r2 > 4) {
            const smooth = n + 1 - Math.log2(Math.log(Math.sqrt(r2)) / Math.log(2));
            return { escaped: true, iterations: n + 1, smooth, orbit };
        }
    }
    return { escaped: false, iterations: maxIter, smooth: maxIter, orbit };
}

/** Julia set membership test for z₀ = (x, y) and parameter c. */
export function juliaEscape(x: number, y: number, cx: number, cy: number, maxIter = 32): number {
    for (let n = 0; n < maxIter; n++) {
        const xn = x * x - y * y + cx;
        y = 2 * x * y + cy;
        x = xn;
        if (x * x + y * y > 4) return n;
    }
    return maxIter;
}

/** A point on the boundary of the main cardioid of the Mandelbrot set. */
export function cardioidBoundary(theta: number): [number, number] {
    return [
        Math.cos(theta) / 2 - Math.cos(2 * theta) / 4,
        Math.sin(theta) / 2 - Math.sin(2 * theta) / 4,
    ];
}

export interface BulbResult {
    /** Distance estimate to the Mandelbulb surface. */
    de: number;
    escaped: boolean;
    /** Smallest |z| seen, an orbit trap used for colouring. */
    trap: number;
}

/** Distance estimator of the power-n Mandelbulb (White & Nylander). */
export function mandelbulb(px: number, py: number, pz: number, power = 8, maxIter = 10): BulbResult {
    let x = px, y = py, z = pz;
    let dr = 1, r = 0, trap = 1e9;
    for (let n = 0; n < maxIter; n++) {
        r = Math.sqrt(x * x + y * y + z * z);
        trap = Math.min(trap, r);
        if (r > 2) return { de: (0.5 * Math.log(r) * r) / dr, escaped: true, trap };
        if (r < 1e-12) { x = px; y = py; z = pz; continue; }
        const theta = Math.acos(z / r) * power;
        const phi = Math.atan2(y, x) * power;
        dr = Math.pow(r, power - 1) * power * dr + 1;
        const zr = Math.pow(r, power);
        x = zr * Math.sin(theta) * Math.cos(phi) + px;
        y = zr * Math.sin(theta) * Math.sin(phi) + py;
        z = zr * Math.cos(theta) + pz;
    }
    return { de: 0, escaped: false, trap };
}

// ---------------------------------------------------------------------------
// Cosmic web
// ---------------------------------------------------------------------------

export interface CosmicWeb {
    /** xyz per galaxy, normalised to the sampled cube, −1..1. */
    positions: Float32Array;
    /** Orbit trap per galaxy, 0..1. */
    traps: Float32Array;
    count: number;
}

/**
 * Scatter galaxies on the surface of the Mandelbulb, inside a cube zoomed onto
 * part of it. Up close the surface is a sponge: the interior of the set
 * becomes the voids, its folded boundary the walls and filaments.
 */
export function cosmicWeb(
    count: number, seed: number, shell = 0.004, center: [number, number, number] = [0.55, 0.35, 0.3], half = 0.4,
): CosmicWeb {
    const rng = mulberry32(seed);
    const positions = new Float32Array(count * 3);
    const traps = new Float32Array(count);
    let n = 0;
    for (let attempts = 0; n < count && attempts < count * 400; attempts++) {
        const x = (rng() * 2 - 1), y = (rng() * 2 - 1), z = (rng() * 2 - 1);
        const b = mandelbulb(center[0] + x * half, center[1] + y * half, center[2] + z * half, 8, 8);
        if (!b.escaped || b.de > shell) continue;
        // Denser right at the surface, thinning away from it.
        if (rng() > b.de / shell) {
            const j = (0.35 * shell) / half;
            positions[n * 3] = x + gaussian(rng) * j;
            positions[n * 3 + 1] = y + gaussian(rng) * j;
            positions[n * 3 + 2] = z + gaussian(rng) * j;
            traps[n] = Math.min(1, b.trap);
            n++;
        }
    }
    return { positions: positions.subarray(0, n * 3), traps: traps.subarray(0, n), count: n };
}

// ---------------------------------------------------------------------------
// Galaxies
// ---------------------------------------------------------------------------

export type GalaxyType = 'spiral' | 'barred' | 'elliptical' | 'irregular';

export interface GalaxySpec {
    seed: number;
    name: string;
    type: GalaxyType;
    arms: number;
    pitchDeg: number;
    /** Disk scale length, ly. */
    scaleLengthLy: number;
    radiusLy: number;
    /** Flat rotation speed, km/s. */
    vFlat: number;
    /** Central supermassive black hole, M☉. */
    bhMassSun: number;
    /** Julia parameter for irregular galaxies. */
    juliaC: [number, number];
    isMilkyWay: boolean;
    /** Its place in the cosmic web's list, to mark it on the map. */
    webIndex?: number;
}

const GALAXY_TYPE_RU: Record<GalaxyType, string> = {
    spiral: 'спиральная (Sb)',
    barred: 'спиральная с перемычкой (SBb)',
    elliptical: 'эллиптическая (E)',
    irregular: 'неправильная (Irr)',
};
export const galaxyTypeName = (t: GalaxyType) => GALAXY_TYPE_RU[t];

export const MILKY_WAY: GalaxySpec = {
    seed: 0x5a17,
    name: 'Млечный Путь',
    type: 'barred',
    arms: 4,
    pitchDeg: 17,
    scaleLengthLy: 8500,
    radiusLy: 50_000,
    vFlat: 230,
    bhMassSun: 4.297e6, // Sgr A*, GRAVITY Collaboration 2023
    juliaC: [-0.8, 0.156],
    isMilkyWay: true,
};

/** A galaxy's properties from where it sits in the cosmic web. */
export function galaxyFromWeb(index: number, x: number, y: number, z: number, trap: number): GalaxySpec {
    const seed = hash32(index, 0x9a1a);
    const rng = mulberry32(seed);
    // Project the galaxy onto the complex plane around the set's interesting region.
    const m = mandelbrot(x * 1.1 - 0.55, z * 1.1, 48);
    let type: GalaxyType;
    if (!m.escaped) type = 'elliptical';           // inside the set: quiet, old, gas-free
    else if (m.smooth > 12) type = rng() < 0.45 ? 'barred' : 'spiral';
    else if (m.smooth > 5) type = rng() < 0.7 ? 'spiral' : 'irregular';
    else type = 'irregular';
    const size = 0.4 + 1.4 * Math.pow(rng(), 1.5) * (0.6 + trap);
    const radiusLy = type === 'irregular' ? 12_000 * size : 45_000 * size;
    // M–σ relation, loosely: bigger and earlier-type galaxies host heavier black holes.
    const bhLog = 5.8 + 2.2 * Math.log10(1 + size * 3) + (type === 'elliptical' ? 1.2 : 0) + rng() * 0.5;
    const [jx, jy] = cardioidBoundary(rng() * Math.PI * 2);
    return {
        seed,
        name: `PGC ${(100_000 + (seed % 900_000)).toString()}`,
        type,
        arms: type === 'barred' ? 2 + Math.floor(rng() * 2) * 2 : 2 + Math.floor(rng() * 3),
        pitchDeg: 9 + rng() * 16,
        scaleLengthLy: radiusLy / 5.5,
        radiusLy,
        vFlat: 120 + 200 * size / 1.8,
        bhMassSun: Math.pow(10, bhLog),
        juliaC: [jx * 1.02, jy * 1.02],
        isMilkyWay: false,
        webIndex: index,
    };
}

/** Stellar masses from the Kroupa (2001) initial mass function, limited to [lo, hi] M☉. */
export function kroupaMass(rng: () => number, lo = 0.08, hi = 60): number {
    // Inverse transform sampling of a broken power law, dN/dm ∝ m^-α.
    const segs = [
        { a: 0.08, b: 0.5, alpha: 1.3 },
        { a: 0.5, b: 150, alpha: 2.3 },
    ].map(s => ({ ...s, a: Math.max(s.a, lo), b: Math.min(s.b, hi) })).filter(s => s.a < s.b);
    const integ = (s: { a: number; b: number; alpha: number }) => {
        const k = 1 - s.alpha;
        // Continuity at 0.5 M☉: k₁·0.5^-1.3 = k₂·0.5^-2.3, so k₁ = 2k₂.
        const norm = s.alpha === 1.3 ? 2 : 1;
        return (norm * (Math.pow(s.b, k) - Math.pow(s.a, k))) / k;
    };
    const weights = segs.map(integ);
    const total = weights.reduce((p, w) => p + w, 0);
    let u = rng() * total;
    for (let k = 0; k < segs.length; k++) {
        if (u <= weights[k] || k === segs.length - 1) {
            const s = segs[k];
            const e = 1 - s.alpha;
            const f = Math.min(1, u / weights[k]);
            return Math.pow(Math.pow(s.a, e) + f * (Math.pow(s.b, e) - Math.pow(s.a, e)), 1 / e);
        }
        u -= weights[k];
    }
    return 1;
}

// ---------------------------------------------------------------------------
// Planetary systems
// ---------------------------------------------------------------------------

export type PlanetKind = 'rocky' | 'venus' | 'earth' | 'desert' | 'gas' | 'ice-giant' | 'lava' | 'ice';

export interface PlanetSpec {
    name: string;
    kind: PlanetKind;
    aAU: number;
    e: number;
    i: number;
    node: number;
    peri: number;
    M0: number;
    periodDays: number;
    massEarth: number;
    radiusEarth: number;
    eqTempK: number;
    habitable: boolean;
    rings: boolean;
    /** Axial tilt, degrees. */
    tilt: number;
    /** Sidereal day, days (negative = retrograde). */
    dayDays: number;
    seed: number;
}

export interface SystemSpec extends StarProps {
    seed: number;
    name: string;
    starMass: number;
    planets: PlanetSpec[];
    /** The point c whose orbit generated the planets. */
    c: [number, number];
    hz: [number, number];
    frost: number;
}

const LETTERS = 'bcdefghijk';

export function starName(seed: number): string {
    return `PTK ${(seed % 90_000 + 10_000).toString()}${String.fromCharCode(65 + (seed >>> 20) % 26)}`;
}

export function generateSystem(seed: number, starMass: number): SystemSpec {
    const rng = mulberry32(seed);
    const star = mainSequence(starMass);
    const hz = habitableZone(star.L);
    const frost = frostLine(star.L);

    // A point just outside the main cardioid: its orbit wanders near the set before escaping.
    const [bx, by] = cardioidBoundary(rng() * Math.PI * 2);
    const push = 1.12 + 0.75 * rng();
    const c: [number, number] = [bx * push + 0.004, by * push];
    const m = mandelbrot(c[0], c[1], 10);
    const count = Math.max(2, Math.min(10, m.iterations));

    const planets: PlanetSpec[] = [];
    let a = (0.12 + 0.35 * rng()) * Math.pow(star.L, 0.3);
    for (let k = 0; k < count; k++) {
        const [zx, zy] = m.orbit[Math.min(k, m.orbit.length - 1)];
        const mod = Math.hypot(zx, zy);
        const arg = Math.atan2(zy, zx);
        const eqTempK = equilibriumTemperature(star.L, a);

        let kind: PlanetKind;
        let massEarth: number;
        if (a > frost) {
            if (rng() < 0.55) { kind = 'gas'; massEarth = Math.exp(Math.log(30) + rng() * Math.log(1500 / 30)); }
            else { kind = 'ice-giant'; massEarth = 8 + rng() * 20; }
        } else {
            massEarth = Math.exp(Math.log(0.05) + rng() * Math.log(8 / 0.05));
            if (eqTempK > 900) kind = 'lava';
            else if (eqTempK > 320) kind = rng() < 0.5 ? 'venus' : 'desert';
            else if (eqTempK > 175 && massEarth > 0.3 && massEarth < 5) kind = 'earth';
            else if (eqTempK < 150) kind = 'ice';
            else kind = rng() < 0.5 ? 'desert' : 'rocky';
        }
        if (massEarth < 0.12 && kind !== 'lava') kind = 'rocky'; // too small to hold an atmosphere
        // A small star cannot keep a pair of super-Jupiters stable at any spacing.
        massEarth = Math.min(massEarth, 1500 * starMass);

        // Keep neighbours dynamically stable: at least ~10 mutual Hill radii apart (Chambers 1996).
        const prev = planets[planets.length - 1];
        if (prev) {
            // R_H = k·(a₁ + a₂)/2, so a₂ − a₁ ≥ 10·R_H solves to a₂ ≥ a₁(1 + 5k)/(1 − 5k).
            const k = mutualHillRadius(1, 1, prev.massEarth, massEarth, starMass);
            if (a - prev.aAU < 10 * mutualHillRadius(prev.aAU, a, prev.massEarth, massEarth, starMass)) {
                a = (prev.aAU * (1 + 5 * k)) / Math.max(1 - 5 * k, 0.2);
            }
        }
        const radiusEarth = planetRadiusFromMass(massEarth);
        planets.push({
            name: LETTERS[k],
            kind,
            aAU: a,
            e: Math.min(0.25, 0.01 + 0.12 * Math.abs(zy) * rng()),
            i: rng() * 3,
            node: rng() * 360,
            peri: rng() * 360,
            M0: ((arg * 180) / Math.PI + 360) % 360,
            periodDays: keplerPeriodDays(a * AU_KM, starMass),
            massEarth,
            radiusEarth,
            eqTempK: equilibriumTemperature(star.L, a),
            habitable: a >= hz[0] && a <= hz[1] && kind === 'earth',
            rings: (kind === 'gas' || kind === 'ice-giant') && rng() < 0.4,
            tilt: rng() < 0.1 ? 60 + rng() * 60 : rng() * 30,
            dayDays: (kind === 'gas' || kind === 'ice-giant' ? 0.4 : 0.8 + rng() * 3) * (rng() < 0.1 ? -1 : 1),
            seed: hash32(seed, k),
        });
        // Orbit ratios of 1.4–2.3, the range seen in Kepler multi-planet systems.
        a *= 1.4 + 0.45 * Math.min(1, mod / 2) + 0.45 * rng();
    }

    return { seed, name: starName(seed), starMass, ...star, planets, c, hz, frost };
}

/** Mass of a planet in solar masses, for Kepler's third law. */
export const earthToSun = (m: number) => m / EARTH_PER_SUN_MASS;
