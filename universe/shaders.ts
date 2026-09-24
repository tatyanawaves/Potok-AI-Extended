// GLSL for the universe viewer. The renderer uses a logarithmic depth buffer
// (distances span from metres to light-years), so every material includes the
// logdepth chunks. Fragment shaders output linear radiance; tone mapping and
// sRGB encoding happen once, in the OutputPass.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
// Ashima Arts 3D simplex noise, range ≈ [-1, 1].
float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}
// Three octaves: for detail that is small on screen or only tilts the normal.
float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}
float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}
`;

// ---------------------------------------------------------------------------
// Planets and moons
// ---------------------------------------------------------------------------

export const PLANET_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}
`;

/**
 * The look of a world's surface at a point of the unit sphere: albedo without clouds, and
 * the masks lighting needs. Shared by the live shader (far away, a few pixels) and the bake
 * that paints it once into a texture for when the world fills the view.
 */
const PLANET_SURFACE = /* glsl */ `
uniform int uKind;
uniform float uSeed;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
// base: albedo without clouds; land: 0 sea … 1 land; wet: where the sea glints;
// glow: emissive mask (city lights, lava); clouds: cloud cover; h: relief height.
void surface(vec3 p, float time, out vec3 base, out float land, out float wet, out float glow, out float clouds, out float h) {
    vec3 sp = p + vec3(uSeed * 0.013, uSeed * 0.007, uSeed * 0.011);
    land = 1.0; wet = 0.0; glow = 0.0; clouds = 0.0; h = 0.0;
    if (uKind == 0 || uKind == 8) { // airless rock: Mercury, the Moon
        float f = fbm(sp * 3.0);
        float d = fbm3(sp * 14.0);
        float craters = smoothstep(0.35, 0.5, abs(snoise(sp * 22.0))) * 0.15;
        base = mix(uColA, uColB, smoothstep(-0.5, 0.6, f)) * (0.85 + 0.3 * d) - craters;
    } else if (uKind == 1) { // Venus: sulphuric-acid cloud deck
        float w = fbm(vec3(sp.x * 2.0, sp.y * 7.0 + fbm(sp * 2.5) * 1.8, sp.z * 2.0) + vec3(time * 0.02, 0.0, 0.0));
        base = mix(uColA, uColB, w * 0.5 + 0.5);
    } else if (uKind == 2) { // Earth-like: oceans, continents, ice; clouds kept apart so they can drift
        float e = fbm(sp * 2.1) + 0.12 * snoise(sp * 9.0);
        float lat = abs(p.y);
        land = smoothstep(0.02, 0.05, e);
        vec3 ocean = mix(vec3(0.004, 0.02, 0.09), vec3(0.01, 0.08, 0.2), smoothstep(-0.4, 0.03, e));
        vec3 green = mix(vec3(0.03, 0.12, 0.03), vec3(0.2, 0.17, 0.08), smoothstep(0.0, 0.5, e + lat * 0.3));
        vec3 desert = vec3(0.45, 0.36, 0.2);
        float dry = smoothstep(0.1, 0.35, 1.0 - abs(lat - 0.3) * 3.0) * smoothstep(0.0, 0.4, fbm3(sp * 3.0 + 5.0));
        base = mix(ocean, mix(green, desert, dry), land);
        float ice = smoothstep(0.78, 0.84, lat + 0.06 * snoise(sp * 6.0));
        base = mix(base, vec3(0.85, 0.88, 0.92), ice);
        clouds = smoothstep(0.12, 0.6, fbm(sp * 3.5 + vec3(time * 0.03, 0.0, time * 0.01)));
        wet = (1.0 - land) * (1.0 - ice);
        glow = step(0.9, hash13(floor(p * 420.0))) * smoothstep(0.25, 0.6, snoise(sp * 6.0)) * land * (1.0 - ice);
        land *= 1.0 - ice * 0.5;
    } else if (uKind == 3) { // desert / Mars
        float f = fbm(sp * 2.4);
        float dark = smoothstep(0.05, 0.3, fbm3(sp * 1.6 + 3.0));
        base = mix(uColA, uColB, smoothstep(-0.5, 0.5, f));
        base *= 1.0 - dark * 0.45;
        float cap = smoothstep(0.88, 0.92, abs(p.y) + 0.04 * snoise(sp * 8.0));
        base = mix(base, vec3(0.9, 0.88, 0.86), cap * uColC.x);
    } else if (uKind == 4) { // gas giant: zonal bands and storms
        float warp = fbm(vec3(sp.x * 3.0, sp.y * 14.0, sp.z * 3.0) + vec3(time * 0.01, 0.0, 0.0));
        float t = p.y * (7.0 + mod(uSeed, 5.0)) + warp * 0.9;
        base = mix(uColA, uColB, 0.5 + 0.5 * sin(t * 3.14159));
        base = mix(base, uColC, smoothstep(0.3, 0.9, fbm(sp * vec3(2.0, 20.0, 2.0))) * 0.35);
        // A long-lived anticyclone, like the Great Red Spot.
        vec3 spot = normalize(vec3(0.8, -0.38, 0.45));
        float s = smoothstep(0.16, 0.05, length((p - spot) * vec3(1.0, 1.8, 1.0)));
        base = mix(base, uColC * 1.1, s * step(0.5, fract(uSeed * 0.37)));
    } else if (uKind == 5) { // ice giant: methane blue, faint bands
        float w = fbm(vec3(sp.x * 2.0, sp.y * 9.0, sp.z * 2.0));
        base = mix(uColA, uColB, 0.5 + 0.5 * sin(p.y * 9.0 + w * 1.2));
    } else if (uKind == 6) { // lava world: dark crust, glowing cracks
        float f = fbm(sp * 4.0);
        glow = 1.0 - smoothstep(0.0, 0.07, abs(fbm(sp * 3.0 + 9.0)));
        base = mix(vec3(0.05, 0.04, 0.035), vec3(0.18, 0.12, 0.09), f * 0.5 + 0.5);
    } else { // ice world
        float f = fbm(sp * 3.0);
        base = mix(vec3(0.62, 0.72, 0.8), vec3(0.95, 0.97, 1.0), f * 0.5 + 0.5);
        float lines = 1.0 - smoothstep(0.0, 0.03, abs(snoise(sp * 7.0)));
        base = mix(base, vec3(0.5, 0.3, 0.22), lines * 0.5);
    }
    h = fbm3(sp * 5.0);
}
`;

/** Equirectangular coordinates of a direction: u along longitude, v along latitude. */
const SPHERE_UV = /* glsl */ `
vec2 sphereUv(vec3 p) { return vec2(atan(p.z, p.x) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.1415927 + 0.5); }
vec3 sphereDir(vec2 uv) {
    float lon = (uv.x - 0.5) * 6.2831853, lat = (uv.y - 0.5) * 3.1415927;
    return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
}
`;

/** Paints a world's surface into two textures, once (see PLANET_FRAG). */
export const PLANET_BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const PLANET_BAKE_FRAG = /* glsl */ `
precision highp float;
uniform int uLayer; // 0: albedo + land; 1: relief, clouds, wet, glow
varying vec2 vUv;
${NOISE}
${PLANET_SURFACE}
${SPHERE_UV}
void main() {
    vec3 base; float land, wet, glow, clouds, h;
    surface(sphereDir(vUv), 0.0, base, land, wet, glow, clouds, h);
    gl_FragColor = uLayer == 0 ? vec4(clamp(base, 0.0, 1.0), land) : vec4(h * 0.5 + 0.5, clouds, wet, glow);
}
`;

export const PLANET_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
uniform vec3 uStarColor;
uniform float uStarIntensity;
uniform float uTime;
uniform vec3 uAtmo;
uniform float uAtmoStrength;
uniform vec4 uRing; // inner, outer radius (world), enabled, unused
uniform mat3 uRot;   // object → world rotation (no scale)
uniform float uBump; // relief strength; 0 for gas and cloud-covered worlds
uniform vec3 uRingNormal;
uniform vec3 uCenter;
// The baked surface: albedo + land, and relief + clouds + wet + glow; uBaked says whether to use it.
uniform sampler2D uAlbedo;
uniform sampler2D uDetail;
uniform float uBaked;
uniform vec2 uTexel; // 1 / detail texture size
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
${PLANET_SURFACE}
${SPHERE_UV}

// Sample an equirectangular texture without a seam where longitude wraps (Tarini's trick):
// of two parametrisations, use the one whose derivatives do not jump.
vec4 sphereTex(sampler2D t, vec2 uv) {
    vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
    vec2 dA = vec2(dFdx(uv.x), dFdy(uv.x)), dB = vec2(dFdx(uvB.x), dFdy(uvB.x));
    bool useB = dot(dB, dB) < dot(dA, dA) - 1e-9;
    vec2 u = useB ? uvB : uv;
    return textureGrad(t, u, vec2(useB ? dB.x : dA.x, dFdx(uv.y)), vec2(useB ? dB.y : dA.y, dFdy(uv.y)));
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vObj);
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSun - vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, L);
    vec3 base; float land, wet, glow, clouds, h;
    vec3 No = p;
    if (uBaked > 0.5) {
        // Read the painted surface: a few texture reads instead of dozens of noise evaluations.
        vec2 uv = sphereUv(p);
        vec4 a = sphereTex(uAlbedo, uv);
        vec4 d = sphereTex(uDetail, uv);
        base = a.rgb; land = a.a; wet = d.b; glow = d.a;
        // Clouds drift eastwards over the ground.
        clouds = uKind == 2 ? sphereTex(uDetail, uv + vec2(uTime * 0.0006, 0.0)).g : 0.0;
        if (uBump > 0.0) {
            // All three heights from the finest level, so the difference is a true slope.
            float h0 = textureLod(uDetail, uv, 0.0).r;
            float hx = textureLod(uDetail, uv + vec2(uTexel.x, 0.0), 0.0).r, hy = textureLod(uDetail, uv + vec2(0.0, uTexel.y), 0.0).r;
            float lat = asin(clamp(p.y, -1.0, 1.0));
            vec3 tLon = normalize(vec3(-p.z, 0.0, p.x) + 1e-6);
            vec3 tLat = vec3(-sin(lat) * cos(atan(p.z, p.x)), cos(lat), -sin(lat) * sin(atan(p.z, p.x)));
            // Heights are stored ×0.5; per radian of longitude and latitude.
            vec2 g = vec2(hx - h0, hy - h0) * 2.0 / (uTexel * vec2(6.2831853, 3.1415927));
            vec3 grad = g.x / max(cos(lat), 0.05) * tLon + g.y * tLat;
            No = normalize(p - uBump * 0.08 * land * (1.0 - clouds) * grad);
        }
    } else {
        surface(p, uTime, base, land, wet, glow, clouds, h);
        if (uBump > 0.0) {
            vec3 t1 = normalize(cross(p, abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
            vec3 t2 = cross(p, t1);
            float e = 0.004;
            vec3 off = vec3(uSeed * 0.013, uSeed * 0.007, uSeed * 0.011);
            float h1 = fbm3((normalize(p + t1 * e) + off) * 5.0);
            float h2 = fbm3((normalize(p + t2 * e) + off) * 5.0);
            vec3 grad = ((h1 - h) * t1 + (h2 - h) * t2) / e;
            No = normalize(p - uBump * 0.08 * land * (1.0 - clouds) * grad);
        }
    }
    if (uBump > 0.0) { N = normalize(uRot * No); ndl = dot(N, L); }

    float terminator = uKind == 0 || uKind == 8 ? 0.02 : uKind == 1 ? 0.25 : uKind == 3 ? 0.04 : uKind == 4 ? 0.18 : uKind == 5 ? 0.2 : 0.08;
    base = mix(base, vec3(0.8), clouds * 0.75);
    float spec = wet * (1.0 - clouds);
    vec3 emissive = vec3(0.0);
    if (uKind == 2) {
        float night = 1.0 - smoothstep(-0.12, 0.05, ndl);
        emissive = vec3(1.0, 0.62, 0.25) * glow * (1.0 - clouds) * night * 0.12;
    } else if (uKind == 6) {
        emissive = vec3(1.0, 0.32, 0.05) * glow * (1.4 + 0.6 * sin(uTime + p.x * 10.0));
    }

    float diff = smoothstep(-terminator, terminator, ndl) * max(ndl, 0.0);
    diff = mix(diff, max(ndl, 0.0), 0.5);

    // Shadow cast by the planet's own rings.
    float ringShadow = 1.0;
    if (uRing.z > 0.5) {
        float denom = dot(L, uRingNormal);
        if (abs(denom) > 1e-5) {
            float t = dot(uCenter - vWorld, uRingNormal) / denom;
            if (t > 0.0) {
                float rr = length(vWorld + L * t - uCenter);
                if (rr > uRing.x && rr < uRing.y) ringShadow = 0.35;
            }
        }
    }

    vec3 H = normalize(L + V);
    float specular = spec * pow(max(dot(N, H), 0.0), 60.0) * 0.6 * step(0.0, ndl);
    vec3 lit = (base * diff + specular) * uStarColor * uStarIntensity;

    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 atmo = uAtmo * uAtmoStrength * rim * smoothstep(-0.25, 0.45, ndl) * uStarColor * uStarIntensity;
    // Faint earthshine / starlight so night sides are not pure black.
    vec3 ambient = base * 0.004;
    gl_FragColor = vec4(lit * ringShadow + atmo + emissive + ambient, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Planetary rings, with the planet's shadow falling across them
// ---------------------------------------------------------------------------

export const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec2 vLocal;
void main() {
    vLocal = position.xy;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}
`;

export const RING_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
uniform vec3 uStarColor;
uniform float uStarIntensity;
uniform vec3 uPlanet;
uniform float uPlanetR;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform float uDensity;
uniform vec3 uColor;
varying vec3 vWorld;
varying vec2 vLocal;
${NOISE}
void main() {
    #include <logdepthbuf_fragment>
    float r = length(vLocal);
    float x = (r - uInner) / (uOuter - uInner);
    if (x < 0.0 || x > 1.0) discard;
    float bands = 0.55 + 0.45 * snoise(vec3(x * 60.0, uSeed, 0.0)) * snoise(vec3(x * 11.0, uSeed + 3.0, 1.0));
    float cassini = smoothstep(0.012, 0.03, abs(x - 0.72)); // a gap cleared by a moon resonance
    float edge = smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.9, x);
    float alpha = clamp(bands * cassini * edge * uDensity, 0.0, 0.95);
    // Is the planet between this ring particle and the star?
    vec3 L = normalize(uSun - vWorld);
    vec3 oc = vWorld - uPlanet;
    float b = dot(oc, L);
    float c = dot(oc, oc) - uPlanetR * uPlanetR;
    float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.03 : 1.0;
    vec3 col = uColor * (0.6 + 0.4 * bands) * uStarColor * uStarIntensity * shadow * 0.8;
    gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// Stars seen up close: granulation and limb darkening
// ---------------------------------------------------------------------------

export const STAR_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vObj);
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = max(dot(N, V), 0.0);
    // Eddington limb darkening, I(μ)/I(1) = (2 + 3μ)/5.
    float limb = (2.0 + 3.0 * mu) / 5.0;
    float gran = fbm(p * 40.0 + vec3(uTime * 0.05, uSeed, 0.0));
    float spots = smoothstep(0.55, 0.7, fbm(p * 4.0 + vec3(uSeed, uTime * 0.005, 0.0)));
    float I = limb * (1.0 + 0.18 * gran) * (1.0 - 0.6 * spots);
    gl_FragColor = vec4(uColor * I * 6.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Point sprites: distant bodies, glows, starfields
// ---------------------------------------------------------------------------

export const SPRITE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
attribute float aSize;
attribute float aRadius;
attribute float aGlow;
uniform float uPx; // pixels per unit of (size / distance)
varying vec3 vColor;
varying float vFade;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1e-9);
    float rpx = aRadius / dist * uPx;
    // A dot while the body is too small to see; it fades as the real sphere grows on screen.
    vFade = aGlow > 0.0 ? 1.0 : 1.0 - smoothstep(1.5, 5.0, rpx);
    gl_PointSize = max(aSize, rpx * aGlow);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

export const SPRITE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vFade;
void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 18.0);
    float halo = exp(-d * 4.0) * 0.35 * (1.0 - d);
    gl_FragColor = vec4(vColor * (core + halo) * vFade, 1.0);
}
`;

// Stars and galaxies as particles. Stars in a galaxy orbit the centre on the
// rotation curve, so the disk shears as it turns — with or without dark matter.
export const PARTICLE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
attribute float aSize;
uniform float uTime;       // Myr
uniform float uVFlat;      // km/s, 0 = no rotation
uniform float uDarkMatter; // 1 = flat rotation curve
uniform float uPx;
uniform float uKmsToLyMyr;
uniform float uMinPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec3 p = position;
    if (uVFlat > 0.0) {
        float r = max(length(p.xz), 1.0);
        float rise = 1.0 - exp(-r / 3000.0);
        float v = uDarkMatter > 0.5 ? uVFlat * rise : uVFlat * rise * sqrt(min(1.0, 9000.0 / r));
        float a = -v * uKmsToLyMyr / r * uTime;
        float c = cos(a), s = sin(a);
        p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float px = aSize * uPx / max(-mv.z, 1e-6);
    gl_PointSize = clamp(px, uMinPx, 48.0);
    // Sub-pixel points dim instead of shrinking, so the total light is kept.
    vAlpha = clamp(px / uMinPx, 0.05, 1.0);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

export const PARTICLE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = mix(exp(-d * d * 6.0), 1.0 - d * d, uSoft) * vAlpha * uOpacity;
    gl_FragColor = vec4(vColor * a, a);
}
`;

// ---------------------------------------------------------------------------
// Black hole: null geodesics in Schwarzschild spacetime, a Shakura–Sunyaev
// accretion disk with Doppler beaming and gravitational redshift, and — as an
// option — the singularity replaced by a loop-quantum-gravity core.
// Units: r_s = 1, c = 1.
// ---------------------------------------------------------------------------

export const BLACKHOLE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLACKHOLE_FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uTanHalfFov;
uniform float uTime;
uniform float uTmax;
uniform float uRin;
uniform float uRout;
uniform float uCore;
uniform float uCoreR;
uniform float uExposure;
uniform float uDoppler;
uniform sampler2D uLUT;
varying vec2 vUv;
${NOISE}

vec3 blackbody(float T) {
    float x = log(clamp(T, 1000.0, 50000.0) / 1000.0) / log(50.0);
    return texture2D(uLUT, vec2(x, 0.5)).rgb;
}

vec3 sky(vec3 d) {
    vec3 col = vec3(0.0);
    for (int k = 0; k < 2; k++) {
        float scale = k == 0 ? 90.0 : 220.0;
        vec3 q = d * scale;
        vec3 cell = floor(q);
        vec3 h = hash33(cell);
        if (h.x > 0.965) {
            vec3 c = cell + 0.25 + 0.5 * hash33(cell + 7.0);
            float dist = length(q - c);
            float T = 2500.0 + 30000.0 * pow(h.y, 3.0);
            col += blackbody(T) * exp(-dist * dist * 60.0) * (0.1 + 0.6 * h.z * h.z) * (k == 0 ? 1.0 : 0.4);
        }
    }
    // A galactic band behind the hole.
    vec3 bandN = normalize(vec3(0.3, 1.0, 0.45));
    float band = exp(-pow(dot(d, bandN) * 4.5, 2.0));
    float dust = smoothstep(-0.1, 0.5, fbm(d * 6.0));
    col += vec3(0.5, 0.42, 0.34) * band * (0.25 + 0.3 * fbm(d * 3.0)) * (1.0 - 0.7 * dust) * 0.06;
    return col;
}

// Luminous accretion flow crossing the plane y = 0 at p, seen along rayDir.
vec4 disk(vec3 p, vec3 rayDir) {
    float r = length(p);
    float x = uRin / r;
    // Shakura–Sunyaev temperature profile, normalised to its peak.
    float T = uTmax * pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;
    float beta = sqrt(0.5 / r);                       // Keplerian speed, v/c
    vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    float cosTheta = dot(vdir, -normalize(rayDir));   // gas velocity · direction to the observer
    float doppler = 1.0 / (gamma * (1.0 - beta * cosTheta));
    float grav = sqrt(max(1.0 - 1.0 / r, 0.0));       // gravitational redshift
    float g = mix(1.0, doppler, uDoppler) * grav;
    float Tobs = T * g;
    float I = pow(g, 4.0) * pow(T / uTmax, 4.0);      // I_ν/ν³ is invariant ⇒ bolometric I ∝ g⁴
    float omega = beta / r;
    float phi = atan(p.z, p.x) - omega * uTime * 4.0;
    vec3 q = vec3(log(r) * 5.0, cos(phi) * 2.5, sin(phi) * 2.5);
    float n = fbm(q + vec3(0.0, 0.0, log(r) * 3.0));
    float dens = smoothstep(uRin, uRin * 1.15, r) * (1.0 - smoothstep(uRout * 0.6, uRout, r)) * (0.45 + 0.55 * smoothstep(-0.4, 0.6, n));
    vec3 c = blackbody(Tobs) * I * uExposure * 0.7;
    return vec4(c, clamp(dens, 0.0, 0.95));
}

// Voronoi cells on a sphere: F1, F2 and the id of the nearest cell.
vec3 voronoi(vec3 q, out vec3 center) {
    vec3 cell = floor(q);
    float f1 = 8.0, f2 = 8.0;
    float id = 0.0;
    center = vec3(0.0);
    for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
    for (int k = -1; k <= 1; k++) {
        vec3 c = cell + vec3(float(i), float(j), float(k));
        vec3 pt = c + hash33(c);
        float d = length(q - pt);
        if (d < f1) { f2 = f1; f1 = d; id = hash13(c); center = pt; }
        else if (d < f2) { f2 = d; }
    }
    return vec3(f1, f2, id);
}

// The quantum core. In loop quantum gravity space is a spin network: each node
// is a flat quantum polyhedron, each link carries spin j and an area
// 8πγℓp²√(j(j+1)). Near Planck density the collapse bounces instead of reaching
// a singularity. Here each flat facet is one quantum of geometry, its colour is
// its spin, and the bright seams are the network's links.
vec3 quantumCore(vec3 ro, vec3 rd) {
    float R = uCoreR * (1.0 + 0.07 * sin(uTime * 0.9));   // the bounce "breathes"
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float disc = b * b - c;
    vec3 col = vec3(0.0);
    // Faint links threading the interior between horizon and core.
    for (int s = 1; s <= 6; s++) {
        float t = float(s) * 0.12;
        vec3 q = (ro + rd * t) * 9.0;
        vec3 cc;
        vec3 v = voronoi(q + uTime * 0.05, cc);
        col += vec3(0.25, 0.4, 1.0) * smoothstep(0.06, 0.0, v.y - v.x) * 0.04;
    }
    if (disc < 0.0) return col;
    float t = -b - sqrt(disc);
    if (t < 0.0) return col;
    vec3 hit = ro + rd * t;
    vec3 n = normalize(hit);
    vec3 center;
    vec3 v = voronoi(n * 5.0, center);
    vec3 facetN = normalize(center);                        // one flat face per quantum
    float j = floor(v.z * 4.0) * 0.5 + 0.5;                 // spin ½, 1, 3⁄2, 2
    float area = sqrt(j * (j + 1.0));
    vec3 spinCol = mix(vec3(0.3, 0.5, 1.0), vec3(1.0, 0.45, 0.9), (j - 0.5) / 1.5);
    float light = 0.35 + 0.65 * max(dot(facetN, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
    float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + v.z * 40.0);
    float seam = smoothstep(0.08, 0.0, v.y - v.x);
    col += spinCol * light * area * 0.25 * pulse + vec3(1.0, 0.95, 0.8) * seam * 0.9;
    return col;
}

void main() {
    vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
    float aspect = uRes.x / uRes.y;
    vec3 dir = normalize(uCamBasis * vec3(ndc.x * aspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
    vec3 pos = uCamPos;
    vec3 vel = dir;
    float h2 = dot(cross(pos, vel), cross(pos, vel));

    vec3 col = vec3(0.0);
    float trans = 1.0;
    bool captured = false;
    for (int i = 0; i < 300; i++) {
        float r = length(pos);
        float dt = clamp(0.07 * (r - 0.6), 0.015, 2.5);
        // Photon orbit equation u'' + u = (3/2) r_s u², written as a force law.
        vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
        vec3 nv = vel + acc * dt;
        vec3 np = pos + nv * dt;
        if (pos.y * np.y < 0.0) {
            vec3 hit = mix(pos, np, pos.y / (pos.y - np.y));
            float rh = length(hit);
            if (rh > uRin * 0.95 && rh < uRout) {
                vec4 d = disk(hit, nv);
                col += trans * d.rgb * d.a;
                trans *= 1.0 - d.a;
            }
        }
        pos = np; vel = nv;
        if (length(pos) < 1.0) { captured = true; break; }
        if (length(pos) > 120.0 && dot(pos, vel) > 0.0) break;
        if (trans < 0.02) break;
    }
    if (captured) {
        if (uCore > 0.0) {
            // Horizon tiled by area quanta, then the core seen through it.
            vec3 center;
            vec3 hv = voronoi(normalize(pos) * 24.0, center);
            float seam = smoothstep(0.05, 0.0, hv.y - hv.x);
            vec3 inside = quantumCore(pos, normalize(vel));
            col += trans * uCore * (inside + vec3(0.35, 0.3, 1.0) * seam * 0.08);
        }
    } else {
        col += trans * sky(normalize(vel));
    }
    gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// A planet's atmosphere seen from space: the same single-scattering integral
// as on the surface, run from the camera through the shell around the planet.
// ---------------------------------------------------------------------------

export const ATMO_SHELL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}
`;

// ---------------------------------------------------------------------------
// The star's corona: a camera-facing glow with slowly turning streamers.
// ---------------------------------------------------------------------------

export const CORONA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

export const CORONA_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
${NOISE}
void main() {
    #include <logdepthbuf_fragment>
    vec2 q = (vUv * 2.0 - 1.0) * 4.0;       // in stellar radii
    float r = length(q);
    if (r < 0.98) discard;                   // the disk itself is drawn by the sphere
    float a = atan(q.y, q.x);
    float glow = exp(-(r - 1.0) * 3.5) * 0.3;
    float streamers = pow(max(fbm(vec3(cos(a) * 2.5, sin(a) * 2.5, uTime * 0.03 + r * 0.25)), 0.0), 1.5) * exp(-(r - 1.0) * 0.9);
    float fade = smoothstep(4.0, 3.0, r);
    gl_FragColor = vec4(uColor * (glow + streamers * 0.45) * fade, 1.0);
}
`;
