// The real Solar System: JPL mean orbital elements at J2000 (Standish),
// physical data from the NASA planetary fact sheets. Periods come from
// Kepler's third law, so the whole system runs on the same physics as the
// generated ones.

import { AU_KM, keplerPeriodDays } from './physics';
import type { PlanetKind } from './mandelbrot';

export interface BodyData {
    name: string;
    kind: PlanetKind | 'moon';
    /** Semi-major axis, km. */
    aKm: number;
    e: number;
    i: number;
    node: number;
    peri: number;
    M0: number;
    periodDays: number;
    radiusKm: number;
    massEarth: number;
    tilt: number;
    dayDays: number;
    albedo: number;
    rings?: boolean;
    moons?: BodyData[];
    note?: string;
    seed: number;
}

// a (AU), e, I, L, ϖ (long. of perihelion), Ω — degrees.
function planet(
    name: string, kind: PlanetKind, a: number, e: number, I: number, L: number, varpi: number, node: number,
    radiusKm: number, massEarth: number, tilt: number, dayDays: number, albedo: number, extra: Partial<BodyData> = {},
): BodyData {
    return {
        name, kind, aKm: a * AU_KM, e, i: I, node, peri: varpi - node, M0: L - varpi,
        periodDays: keplerPeriodDays(a * AU_KM, 1), radiusKm, massEarth, tilt, dayDays, albedo,
        seed: name.length * 7919 + name.charCodeAt(0), ...extra,
    };
}

function moon(name: string, aKm: number, periodDays: number, radiusKm: number, massEarth: number, M0: number, i = 0): BodyData {
    return {
        name, kind: 'moon', aKm, e: 0.01, i, node: 0, peri: 0, M0, periodDays, radiusKm, massEarth,
        tilt: 0, dayDays: periodDays, albedo: 0.12, seed: aKm | 0,
    };
}

export const SUN = {
    name: 'Солнце',
    radiusKm: 695_700,
    massSun: 1,
    T: 5772,
    L: 1,
};

export const SOLAR_SYSTEM: BodyData[] = [
    planet('Меркурий', 'rocky', 0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
        2439.7, 0.0553, 0.03, 58.646, 0.088),
    planet('Венера', 'venus', 0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
        6051.8, 0.815, 177.4, -243.02, 0.76),
    planet('Земля', 'earth', 1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0,
        6371, 1, 23.44, 0.99727, 0.306, {
            moons: [moon('Луна', 384_400, 27.321_661, 1737.4, 0.0123, 135, 5.145)],
        }),
    planet('Марс', 'desert', 1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
        3389.5, 0.107, 25.19, 1.025_96, 0.25, {
            moons: [
                moon('Фобос', 9376, 0.318_91, 11.27, 1.8e-9, 20, 1.08),
                moon('Деймос', 23_463, 1.262_44, 6.2, 2.5e-10, 200, 1.79),
            ],
        }),
    planet('Юпитер', 'gas', 5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
        69_911, 317.8, 3.13, 0.413_54, 0.503, {
            moons: [
                moon('Ио', 421_700, 1.769, 1821.6, 0.015, 10),
                moon('Европа', 671_034, 3.551, 1560.8, 0.008, 100),
                moon('Ганимед', 1_070_412, 7.155, 2634.1, 0.025, 200),
                moon('Каллисто', 1_882_709, 16.689, 2410.3, 0.018, 300),
            ],
        }),
    planet('Сатурн', 'gas', 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
        58_232, 95.2, 26.73, 0.444, 0.342, {
            rings: true,
            moons: [moon('Титан', 1_221_870, 15.945, 2574.7, 0.0225, 50, 0.35)],
        }),
    planet('Уран', 'ice-giant', 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503,
        25_362, 14.5, 97.77, -0.718, 0.3, { rings: true }),
    planet('Нептун', 'ice-giant', 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
        24_622, 17.1, 28.32, 0.6713, 0.29, {
            moons: [moon('Тритон', 354_759, 5.877, 1353.4, 0.0036, 80, 157)],
        }),
];
