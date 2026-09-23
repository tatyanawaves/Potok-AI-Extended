// Terrain height, written twice: in TypeScript for collisions and in GLSL
// for the mesh. Both use the same float operations on small coordinates
// (km × frequency), so their results agree to well under a metre.

export interface TerrainParams {
    /** Relief amplitude, m. */
    relief: number;
    craters: boolean;
    /** Shifts the noise so every world has its own landscape. */
    seed: number;
    /** Share of the surface below sea level, via a bias on the continents. */
    seaBias: number;
}

const fract = (x: number) => x - Math.floor(x);

function hash(x: number, y: number): number {
    let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d; p3y += d; p3z += d;
    return fract((p3x + p3y) * p3z);
}

function vnoise(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return ((a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy) * 2 - 1;
}

function fbm(x: number, y: number, octaves: number): number {
    let s = 0, a = 0.5;
    for (let i = 0; i < octaves; i++) {
        s += a * vnoise(x, y);
        const nx = 0.8 * x - 0.6 * y, ny = 0.6 * x + 0.8 * y;
        x = nx * 2.03 + 1.7; y = ny * 2.03 + 9.2;
        a *= 0.5;
    }
    return s;
}

function ridged(x: number, y: number, octaves: number): number {
    let s = 0, a = 0.5, w = 1;
    for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(vnoise(x, y));
        n *= n * w;
        w = Math.min(1, Math.max(0, n * 2));
        s += a * n;
        const nx = 0.8 * x - 0.6 * y, ny = 0.6 * x + 0.8 * y;
        x = nx * 2.1 + 3.1; y = ny * 2.1 + 5.3;
        a *= 0.5;
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

/** Height (m) of the ground at (x, z) m. */
export function terrainHeight(p: TerrainParams, xM: number, zM: number): number {
    const x = xM * 0.0001 + p.seed, y = zM * 0.0001 + p.seed * 0.7;
    const base = fbm(x * 0.35, y * 0.35, 4) + p.seaBias;
    const mountains = ridged(x, y, 6) * Math.min(1, Math.max(0, (base + 0.1) * 2.5));
    let h = p.relief * (0.8 * base + 0.9 * mountains);
    if (p.craters) h += p.relief * 0.6 * craters(x * 1.3, y * 1.3);
    return h;
}

/** The same function in GLSL; `#define`s carry the parameters. */
export const TERRAIN_GLSL = /* glsl */ `
float thash(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float tnoise(vec2 q) {
    vec2 i = floor(q), f = q - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = thash(i), b = thash(i + vec2(1.0, 0.0)), c = thash(i + vec2(0.0, 1.0)), d = thash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
float tfbm(vec2 q, int octaves) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        s += a * tnoise(q);
        q = vec2(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}
float tridged(vec2 q, int octaves) {
    float s = 0.0, a = 0.5, w = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        float n = 1.0 - abs(tnoise(q));
        n *= n * w;
        w = clamp(n * 2.0, 0.0, 1.0);
        s += a * n;
        q = vec2(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.1 + vec2(3.1, 5.3);
        a *= 0.5;
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
float terrainHeight(vec2 xz, int detail) {
    vec2 q = xz * 0.0001 + vec2(uSeed, uSeed * 0.7);
    float base = tfbm(q * 0.35, 4) + uSeaBias;
    float mountains = tridged(q, detail) * clamp((base + 0.1) * 2.5, 0.0, 1.0);
    float h = uRelief * (0.8 * base + 0.9 * mountains);
    if (uCraters > 0.5) h += uRelief * 0.6 * tcraters(q * 1.3);
    return h;
}
`;
