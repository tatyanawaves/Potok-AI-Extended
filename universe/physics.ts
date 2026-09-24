// Physical constants and laws used by the universe viewer. Everything here is
// plain math with no three.js, so it can be unit-tested.

export const C_KM_S = 299_792.458;
export const AU_KM = 149_597_870.7;
export const LY_KM = 9.460_730_472_580_8e12;
export const GM_SUN_KM3_S2 = 1.327_124_400_18e11;
export const M_SUN_KG = 1.988_47e30;
export const M_EARTH_KG = 5.9722e24;
export const EARTH_PER_SUN_MASS = M_SUN_KG / M_EARTH_KG; // ≈ 332 946
export const R_EARTH_KM = 6371;
export const R_SUN_KM = 695_700;
export const T_SUN_K = 5772;
export const PLANCK_LENGTH_M = 1.616_255e-35;
export const PLANCK_MASS_KG = 2.176_434e-8;
export const BARBERO_IMMIRZI = 0.2375; // γ from black-hole entropy counting
export const DAY_S = 86_400;

// ---------------------------------------------------------------------------
// Scale of the star-system view.
//
// One scene unit is a million kilometres. Bodies keep their real sizes and
// moons their real orbits, but the orbits around the star are drawn ten times
// tighter (ORBIT_SCALE), so the planets are neighbours rather than dots
// lost in the dark. The ship's cruise speed crosses the drawn gap between
// Earth's and Mars's orbits (0.524 AU, 78 million km, shown as 7.8) in 12 s.
// ---------------------------------------------------------------------------
export const UNIT_KM = 1e6;
export const ORBIT_SCALE = 0.1;
/** One astronomical unit of heliocentric distance, in scene units. */
export const SCENE_AU = (AU_KM * ORBIT_SCALE) / UNIT_KM;
export const EARTH_A_AU = 1.000_002_61;
export const MARS_A_AU = 1.523_710_34;
export const EARTH_MARS_FLIGHT_S = 12;
export const EARTH_MARS_GAP_KM = (MARS_A_AU - EARTH_A_AU) * AU_KM;
/** Speed in scene-km per second: drawn distances, not real ones. */
export const SHIP_CRUISE_KM_S = (EARTH_MARS_GAP_KM * ORBIT_SCALE) / EARTH_MARS_FLIGHT_S;
export const SHIP_CRUISE_UNITS_S = SHIP_CRUISE_KM_S / UNIT_KM;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Kepler's laws
// ---------------------------------------------------------------------------

export interface OrbitalElements {
    /** Semi-major axis, km. */
    a: number;
    e: number;
    /** Inclination, degrees. */
    i: number;
    /** Longitude of the ascending node Ω, degrees. */
    node: number;
    /** Argument of periapsis ω, degrees. */
    peri: number;
    /** Mean anomaly at t = 0, degrees. */
    M0: number;
    /** Orbital period, days. */
    period: number;
}

/** Eccentric anomaly E from mean anomaly M (radians): E − e·sin E = M. */
export function solveKepler(M: number, e: number): number {
    M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
    for (let k = 0; k < 30; k++) {
        const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= d;
        if (Math.abs(d) < 1e-12) break;
    }
    return E;
}

/** Position on an orbit at time t (days), in the units of `el.a`, ecliptic frame (z = north). */
export function orbitalPosition(el: OrbitalElements, tDays: number, out: number[] = [0, 0, 0]): number[] {
    const M = (el.M0 + (360 * tDays) / el.period) * DEG;
    const E = solveKepler(M, el.e);
    const xp = el.a * (Math.cos(E) - el.e);
    const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
    return rotateOrbit(el, xp, yp, out);
}

/** Point on an orbit at a given eccentric anomaly (for drawing the ellipse). */
export function orbitPointAtE(el: OrbitalElements, E: number, out: number[] = [0, 0, 0]): number[] {
    const xp = el.a * (Math.cos(E) - el.e);
    const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
    return rotateOrbit(el, xp, yp, out);
}

function rotateOrbit(el: OrbitalElements, xp: number, yp: number, out: number[]): number[] {
    const cw = Math.cos(el.peri * DEG), sw = Math.sin(el.peri * DEG);
    const cO = Math.cos(el.node * DEG), sO = Math.sin(el.node * DEG);
    const ci = Math.cos(el.i * DEG), si = Math.sin(el.i * DEG);
    out[0] = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
    out[1] = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
    out[2] = sw * si * xp + cw * si * yp;
    return out;
}

/** Kepler's third law: period in days of an orbit of semi-major axis a (km) around mass M (solar masses). */
export function keplerPeriodDays(aKm: number, massSun: number): number {
    return (2 * Math.PI * Math.sqrt((aKm * aKm * aKm) / (GM_SUN_KM3_S2 * massSun))) / DAY_S;
}

/** Vis-viva equation: orbital speed (km/s) at distance r on an orbit of semi-major axis a (both km). */
export function visViva(rKm: number, aKm: number, massSun: number): number {
    return Math.sqrt(GM_SUN_KM3_S2 * massSun * (2 / rKm - 1 / aKm));
}

/** Days since J2000.0 (2000-01-01 12:00 TT, taken as UTC here). */
export function daysSinceJ2000(date: Date): number {
    return (date.getTime() - Date.UTC(2000, 0, 1, 12)) / (DAY_S * 1000);
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

export interface StarProps {
    /** Luminosity, L☉. */
    L: number;
    /** Radius, R☉. */
    R: number;
    /** Effective temperature, K. */
    T: number;
}

/** Main-sequence mass–luminosity and mass–radius relations. */
export function mainSequence(massSun: number): StarProps {
    const m = massSun;
    let L: number;
    if (m < 0.43) L = 0.23 * Math.pow(m, 2.3);
    else if (m < 2) L = Math.pow(m, 4);
    else if (m < 55) L = 1.4 * Math.pow(m, 3.5);
    else L = 32_000 * m;
    const R = m <= 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57);
    // Stefan–Boltzmann: L = 4πR²σT⁴
    const T = T_SUN_K * Math.pow(L / (R * R), 0.25);
    return { L, R, T };
}

/** Conservative habitable zone (AU) for a star of luminosity L (L☉), after Kopparapu et al. */
export function habitableZone(L: number): [number, number] {
    return [Math.sqrt(L / 1.1), Math.sqrt(L / 0.53)];
}

/** The snow line (AU): beyond it water freezes and giant planets can form. */
export function frostLine(L: number): number {
    return 2.7 * Math.sqrt(L);
}

/** Radiative equilibrium temperature (K) of a planet at a AU from a star of luminosity L. */
export function equilibriumTemperature(L: number, aAU: number, albedo = 0.3): number {
    return (278.6 * Math.pow(1 - albedo, 0.25) * Math.pow(L, 0.25)) / Math.sqrt(aAU);
}

/** Chen & Kipping (2017) probabilistic mass–radius relation, mean branch. Earth units. */
export function planetRadiusFromMass(massEarth: number): number {
    if (massEarth < 2.04) return 1.008 * Math.pow(massEarth, 0.279);
    if (massEarth < 131.6) return 0.808 * Math.pow(massEarth, 0.589);
    return 17.74 * Math.pow(massEarth, -0.044);
}

/** Surface gravity, m/s². */
export function surfaceGravity(massEarth: number, radiusEarth: number): number {
    return (9.807 * massEarth) / (radiusEarth * radiusEarth);
}

/** Escape velocity, km/s. */
export function escapeVelocity(massEarth: number, radiusEarth: number): number {
    return 11.186 * Math.sqrt(massEarth / radiusEarth);
}

/** Mutual Hill radius (AU) of two neighbouring planets; masses in Earth masses. */
export function mutualHillRadius(a1: number, a2: number, m1: number, m2: number, starMass: number): number {
    return Math.cbrt((m1 + m2) / EARTH_PER_SUN_MASS / (3 * starMass)) * ((a1 + a2) / 2);
}

// ---------------------------------------------------------------------------
// Colour of thermal light
// ---------------------------------------------------------------------------

function lobe(x: number, mu: number, s1: number, s2: number): number {
    const t = (x - mu) / (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
}

/**
 * Linear sRGB colour of a black body at temperature T (K), normalised so the
 * brightest channel is 1. Planck's law is integrated against the CIE 1931
 * observer (Wyman, Sloan & Shirley 2013 analytic fit).
 */
export function blackbodyRGB(T: number): [number, number, number] {
    let X = 0, Y = 0, Z = 0;
    for (let nm = 380; nm <= 780; nm += 5) {
        const l = nm * 1e-9;
        const B = 1 / (Math.pow(l, 5) * (Math.exp(1.438_776_9e-2 / (l * T)) - 1));
        X += B * (1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2));
        Y += B * (0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1));
        Z += B * (1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8));
    }
    const r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
    const g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
    const b = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z);
    const m = Math.max(r, g, b) || 1;
    return [r / m, g / m, b / m];
}

const LUT_MIN = 1000, LUT_MAX = 50_000, LUT_N = 256;
let lut: Float32Array | null = null;

/** Table of blackbody colours on a log scale of temperature; RGB triplets. */
export function blackbodyLUT(): Float32Array {
    if (lut) return lut;
    lut = new Float32Array(LUT_N * 3);
    for (let k = 0; k < LUT_N; k++) {
        const T = LUT_MIN * Math.pow(LUT_MAX / LUT_MIN, k / (LUT_N - 1));
        lut.set(blackbodyRGB(T), k * 3);
    }
    return lut;
}
export const BLACKBODY_LUT_RANGE = { min: LUT_MIN, max: LUT_MAX, size: LUT_N };

/** Fast blackbody colour through the lookup table. */
export function blackbodyFast(T: number, out: number[] = [0, 0, 0]): number[] {
    const table = blackbodyLUT();
    const x = Math.log(Math.min(LUT_MAX, Math.max(LUT_MIN, T)) / LUT_MIN) / Math.log(LUT_MAX / LUT_MIN);
    const k = Math.round(x * (LUT_N - 1)) * 3;
    out[0] = table[k]; out[1] = table[k + 1]; out[2] = table[k + 2];
    return out;
}

// ---------------------------------------------------------------------------
// Black holes: general relativity and loop quantum gravity
// ---------------------------------------------------------------------------

/** Schwarzschild radius r_s = 2GM/c², km. */
export function schwarzschildRadiusKm(massSun: number): number {
    return (2 * GM_SUN_KM3_S2 * massSun) / (C_KM_S * C_KM_S);
}

/** Rate of a static clock at r (in units of r_s) relative to one far away. */
export function gravitationalTimeDilation(rOverRs: number): number {
    return rOverRs <= 1 ? 0 : Math.sqrt(1 - 1 / rOverRs);
}

/** Hawking temperature, K. */
export function hawkingTemperatureK(massSun: number): number {
    return 6.169e-8 / massSun;
}

/** Horizon area, m². */
export function horizonAreaM2(massSun: number): number {
    const rs = schwarzschildRadiusKm(massSun) * 1000;
    return 4 * Math.PI * rs * rs;
}

/** Smallest non-zero eigenvalue of the LQG area operator (spin j = 1/2), m². */
export function lqgAreaGapM2(): number {
    return 4 * Math.sqrt(3) * Math.PI * BARBERO_IMMIRZI * PLANCK_LENGTH_M * PLANCK_LENGTH_M;
}

/** Area (m²) carried by one spin-network link of spin j: 8πγ ℓp² √(j(j+1)). */
export function lqgAreaQuantumM2(j: number): number {
    return 8 * Math.PI * BARBERO_IMMIRZI * PLANCK_LENGTH_M * PLANCK_LENGTH_M * Math.sqrt(j * (j + 1));
}

/** How many minimal flat quanta of area tile the horizon. */
export function horizonAreaQuanta(massSun: number): number {
    return horizonAreaM2(massSun) / lqgAreaGapM2();
}

/**
 * Radius (m) of the Planck-density core that replaces the singularity in the
 * "Planck star" picture (Rovelli & Vidotto 2014): r ≈ (m / m_P)^(1/3) ℓ_P.
 */
export function planckStarCoreRadiusM(massSun: number): number {
    return Math.cbrt((massSun * M_SUN_KG) / PLANCK_MASS_KG) * PLANCK_LENGTH_M;
}

// ---------------------------------------------------------------------------
// Galaxies
// ---------------------------------------------------------------------------

/** 1 km/s expressed in light-years per million years. */
export const KM_S_IN_LY_PER_MYR = (1e6 * 365.25 * DAY_S) / LY_KM;

/**
 * Circular speed (km/s) at radius r (ly). With dark matter the rotation curve
 * rises and stays flat; with visible matter alone it falls off as Kepler
 * predicts past the bulk of the disk.
 */
export function rotationCurve(rLy: number, vFlat: number, darkMatter: boolean): number {
    const rise = 1 - Math.exp(-rLy / 3000);
    if (darkMatter) return vFlat * rise;
    const rPeak = 9000;
    return vFlat * rise * Math.sqrt(Math.min(1, rPeak / Math.max(rLy, 1)));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtNum(x: number, digits = 3): string {
    if (!isFinite(x)) return '∞';
    if (x === 0) return '0';
    const ax = Math.abs(x);
    if (ax >= 1e6 || ax < 1e-3) {
        const exp = Math.floor(Math.log10(ax));
        const mant = x / Math.pow(10, exp);
        return `${mant.toFixed(2)}·10${superscript(exp)}`;
    }
    return Number(x.toPrecision(digits)).toLocaleString('ru-RU');
}

function superscript(n: number): string {
    const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(n).split('').map(c => map[c] ?? c).join('');
}

export function fmtDistanceKm(km: number): string {
    if (km < 1e4) return `${fmtNum(km)} км`;
    if (km < 1e9) return `${fmtNum(km / 1e6)} млн км`;
    if (km < 0.05 * LY_KM) return `${fmtNum(km / AU_KM)} а.е.`;
    return `${fmtNum(km / LY_KM)} св. лет`;
}

export function fmtDuration(s: number): string {
    if (!isFinite(s)) return '∞';
    if (s < 60) return `${s.toFixed(1)} с`;
    if (s < 3600) return `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с`;
    if (s < DAY_S) return `${(s / 3600).toFixed(1)} ч`;
    if (s < 365.25 * DAY_S) return `${(s / DAY_S).toFixed(1)} сут`;
    return `${fmtNum(s / (365.25 * DAY_S))} г.`;
}

/** Harvard spectral class from effective temperature. */
export function spectralClass(T: number): string {
    const classes: [number, string][] = [[30_000, 'O'], [10_000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K']];
    for (const [min, c] of classes) if (T >= min) return `${c}V`;
    return 'MV';
}
