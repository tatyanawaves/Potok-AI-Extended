// Terrain height, written twice: in TypeScript for collisions and in GLSL
// for the mesh. Both use the same float operations on small coordinates, so
// their results agree to well under a metre.
//
// Mountains use "erosion" fBm (Quílez): value noise with analytic
// derivatives, where each octave is damped by the slope accumulated so far.
// Steep flanks stay smooth and gullies branch like water-carved relief,
// instead of the blobby dunes plain fBm gives.

export interface TerrainParams {
    /** Relief amplitude, m. */
    relief: number;
    craters: boolean;
    /** Shifts the noise so every world has its own landscape. */
    seed: number;
    /** Raises or lowers the continents against sea level. */
    seaBias: number;
}

const fract = (x: number) => x - Math.floor(x);

function hash(x: number, y: number): number {
    let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d; p3y += d; p3z += d;
    return fract((p3x + p3y) * p3z);
}

/** Value noise in [-1, 1] and its gradient. */
function noised(x: number, y: number, out: number[]): number[] {
    const ix = Math.floor(x), iy = Math.floor(y);
    const wx = x - ix, wy = y - iy;
    const ux = wx * wx * wx * (wx * (wx * 6 - 15) + 10), uy = wy * wy * wy * (wy * (wy * 6 - 15) + 10);
    const dux = 30 * wx * wx * (wx * (wx - 2) + 1), duy = 30 * wy * wy * (wy * (wy - 2) + 1);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    out[0] = -1 + 2 * (a + k1 * ux + k2 * uy + k4 * ux * uy);
    out[1] = 2 * dux * (k1 + k4 * uy);
    out[2] = 2 * duy * (k2 + k4 * ux);
    return out;
}

const nd = [0, 0, 0];

/** Plain fBm of value noise, for the continents. */
function fbm(x: number, y: number, octaves: number): number {
    let s = 0, a = 0.5;
    for (let i = 0; i < octaves; i++) {
        s += a * noised(x, y, nd)[0];
        const nx = 0.8 * x - 0.6 * y, ny = 0.6 * x + 0.8 * y;
        x = nx * 2.03 + 1.7; y = ny * 2.03 + 9.2;
        a *= 0.5;
    }
    return s;
}

/** Erosion fBm: each octave is divided by (1 + |∑∇|²), so slopes stay clean and valleys branch. */
function erosion(x: number, y: number, octaves: number): number {
    let s = 0, b = 0.5, dx = 0, dy = 0;
    for (let i = 0; i < octaves; i++) {
        noised(x, y, nd);
        dx += nd[1]; dy += nd[2];
        s += (b * nd[0]) / (1 + dx * dx + dy * dy);
        const nx = 0.8 * x - 0.6 * y, ny = 0.6 * x + 0.8 * y;
        x = nx * 2.0 + 3.1; y = ny * 2.0 + 5.3;
        b *= 0.5;
    }
    return s;
}

/** Bowl-shaped craters with raised rims, one per cell of a jittered grid. */
function craters(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    let h = 0;
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const cx = ix + i, cy = iy + j;
            const r = 0.12 + 0.3 * hash(cx + 17.0, cy + 3.0);
            if (hash(cx + 5.0, cy + 11.0) < 0.35) continue;
            const px = cx + hash(cx, cy + 7.0), py = cy + hash(cx + 7.0, cy);
            const d = Math.hypot(x - px, y - py) / r;
            if (d < 1) h -= (1 - d * d) * r;
            const rim = (d - 1) / 0.25;
            h += Math.exp(-rim * rim) * r * 0.35;
        }
    }
    return h;
}

export const TERRAIN_OCTAVES = 8;

/** Height (m) of the ground at (x, z) m. */
export function terrainHeight(p: TerrainParams, xM: number, zM: number, octaves = TERRAIN_OCTAVES): number {
    const x = xM * 0.00008 + p.seed, y = zM * 0.00008 + p.seed * 0.7;
    const base = fbm(x * 0.3, y * 0.3, 4) + p.seaBias;
    const land = Math.min(1, Math.max(0, (base + 0.05) / 0.4));
    const mask = land * land * (3 - 2 * land);
    let h = p.relief * (0.55 * base + 0.9 * mask * erosion(x, y, octaves));
    if (p.craters) h += p.relief * 0.6 * craters(x * 1.6, y * 1.6);
    return h;
}

/** The same functions in GLSL. */
export const TERRAIN_GLSL = /* glsl */ `
float thash(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec3 tnoised(vec2 q) {
    vec2 i = floor(q), w = q - i;
    vec2 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
    float a = thash(i), b = thash(i + vec2(1.0, 0.0)), c = thash(i + vec2(0.0, 1.0)), d = thash(i + vec2(1.0, 1.0));
    float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    return vec3(-1.0 + 2.0 * (a + k1 * u.x + k2 * u.y + k4 * u.x * u.y), 2.0 * du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float tnoise(vec2 q) { return tnoised(q).x; }
float tfbm(vec2 q, int octaves) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 12; i++) {
        if (i >= octaves) break;
        s += a * tnoised(q).x;
        q = vec2(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}
float terosion(vec2 q, int octaves) {
    float s = 0.0, b = 0.5;
    vec2 d = vec2(0.0);
    for (int i = 0; i < 14; i++) {
        if (i >= octaves) break;
        vec3 n = tnoised(q);
        d += n.yz;
        s += b * n.x / (1.0 + dot(d, d));
        q = vec2(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.0 + vec2(3.1, 5.3);
        b *= 0.5;
    }
    return s;
}
float tcraters(vec2 q) {
    vec2 i0 = floor(q);
    float h = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 c = i0 + vec2(float(i), float(j));
        float r = 0.12 + 0.3 * thash(c + vec2(17.0, 3.0));
        if (thash(c + vec2(5.0, 11.0)) < 0.35) continue;
        vec2 pc = c + vec2(thash(c + vec2(0.0, 7.0)), thash(c + vec2(7.0, 0.0)));
        float d = length(q - pc) / r;
        if (d < 1.0) h -= (1.0 - d * d) * r;
        float rim = (d - 1.0) / 0.25;
        h += exp(-rim * rim) * r * 0.35;
    }
    return h;
}
uniform float uRelief;
uniform float uSeed;
uniform float uSeaBias;
uniform float uCraters;
float terrainHeight(vec2 xz, int octaves) {
    vec2 q = xz * 0.00008 + vec2(uSeed, uSeed * 0.7);
    float base = tfbm(q * 0.3, 4) + uSeaBias;
    float land = clamp((base + 0.05) / 0.4, 0.0, 1.0);
    float mask = land * land * (3.0 - 2.0 * land);
    float h = uRelief * (0.55 * base + 0.9 * mask * terosion(q, octaves));
    if (uCraters > 0.5) h += uRelief * 0.6 * tcraters(q * 1.6);
    return h;
}
`;
