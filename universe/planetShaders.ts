// Shaders for standing on a planet: a physically based sky (the GLSL twin of
// atmosphere.ts), terrain lit by sunlight that has crossed the atmosphere and
// seen through it (aerial perspective), and water with Fresnel reflection.
// Scene units are metres; the atmosphere math runs in planet radii.

import { TERRAIN_GLSL } from './terrain';

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform float uHasAtmo;
uniform float uTop;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform float uHR;
uniform float uHM;
uniform float uG;
uniform vec3 uForwardTint;
uniform float uMulti;
uniform vec3 uAbsorbM;
uniform float uSunIntensity;
uniform vec3 uSunDir;
uniform float uPlanetR;   // metres
uniform float uCamAlt;    // metres above the datum

vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
}

// In-scattered light along ro + rd·t for t in [0, maxT] (planet radii), and the transmittance.
vec3 scatter(vec3 ro, vec3 rd, float maxT, out vec3 transmittance) {
    transmittance = vec3(1.0);
    if (uHasAtmo < 0.5) return vec3(0.0);
    vec2 a = raySphere(ro, rd, uTop);
    if (a.x > a.y || a.y < 0.0) return vec3(0.0);
    vec2 gr = raySphere(ro, rd, 1.0);
    float tEnd = min(a.y, maxT);
    if (gr.x > 0.0) tEnd = min(tEnd, gr.x);
    float tStart = max(a.x, 0.0);
    if (tEnd <= tStart) return vec3(0.0);
    float seg = (tEnd - tStart) / float(STEPS);
    float mu = dot(rd, uSunDir);
    float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float g = uG;
    float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5))
        + uMulti / (4.0 * 3.14159265);
    vec3 tint = mix(vec3(1.0), uForwardTint, pow(max(mu, 0.0), 16.0));
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (tStart + seg * (float(i) + 0.5));
        float h = length(p) - 1.0;
        float dR = exp(-h / uHR) * seg, dM = exp(-h / uHM) * seg;
        odR += dR; odM += dM;
        vec2 l = raySphere(p, uSunDir, uTop);
        float segL = l.y / float(LIGHT_STEPS);
        float lR = 0.0, lM = 0.0;
        bool blocked = false;
        for (int j = 0; j < LIGHT_STEPS; j++) {
            vec3 pl = p + uSunDir * (segL * (float(j) + 0.5));
            float hl = length(pl) - 1.0;
            if (hl < 0.0) { blocked = true; break; }
            lR += exp(-hl / uHR) * segL;
            lM += exp(-hl / uHM) * segL;
        }
        if (blocked) continue;
        vec3 att = exp(-(uBetaR * (odR + lR) + (uBetaM * 1.1 + uAbsorbM) * (odM + lM)));
        sumR += att * dR;
        sumM += att * dM;
    }
    transmittance = exp(-(uBetaR * odR + (uBetaM * 1.1 + uAbsorbM) * odM));
    return uSunIntensity * (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM * tint);
}

// Observer position in planet radii: the local flat ground is tangent to the sphere at the origin.
vec3 observer() { return vec3(0.0, 1.0 + uCamAlt / uPlanetR, 0.0); }
`;

// ---------------------------------------------------------------------------

export const SKY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}
`;

export const SKY_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
#define STEPS 16
#define LIGHT_STEPS 8
${ATMOSPHERE_GLSL}
uniform vec3 uSunColor;
varying vec3 vDir;
vec3 h33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}
void main() {
    #include <logdepthbuf_fragment>
    vec3 rd = normalize(vDir);
    vec3 trans;
    vec3 col = scatter(observer(), rd, 1e9, trans);
    // The Sun's disk (0.27° radius at 1 AU), limb-darkened, dimmed by the air in front of it.
    float cosSun = dot(rd, uSunDir);
    float disk = smoothstep(0.99997, 0.999985, cosSun);
    col += uSunColor * disk * 40.0 * trans;
    // Stars come out where the sky is dark.
    float sky = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 q = rd * 260.0;
    vec3 cell = floor(q);
    vec3 h = h33(cell);
    if (h.x > 0.975 && rd.y > -0.05) {
        float d = length(q - cell - 0.5 - 0.35 * (h33(cell + 3.0) - 0.5));
        col += vec3(0.8 + 0.2 * h.y, 0.85, 0.8 + 0.3 * h.z) * exp(-d * d * 40.0) * (0.3 + 1.5 * h.z * h.z) * trans * clamp(1.0 - sky * 8.0, 0.0, 1.0);
    }
    // Below the horizon of an airless world: the ground will cover it, but keep it black.
    gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------

export const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_GLSL}
uniform vec2 uOffset;
varying vec3 vWorld;
varying float vDrop;
void main() {
    vec2 xz = position.xz + uOffset;
    float h = terrainHeight(xz, 6);
    // The ground curves away with the planet: drop = d² / 2R.
    vec2 rel = xz - cameraPosition.xz;
    float drop = dot(rel, rel) / (2.0 * uPlanetRV);
    vWorld = vec3(xz.x, h, xz.y);
    vDrop = drop;
    gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, h - drop, xz.y, 1.0);
    #include <logdepthbuf_vertex>
}
`.replace('uniform vec2 uOffset;', 'uniform vec2 uOffset;\nuniform float uPlanetRV;');

export const TERRAIN_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
#define STEPS 8
#define LIGHT_STEPS 4
${TERRAIN_GLSL}
${ATMOSPHERE_GLSL}
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform int uPalette;
uniform float uSea;
uniform float uTime;
varying vec3 vWorld;
varying float vDrop;

vec3 palette(float h, float slope, vec2 xz, float n) {
    float rel = h / max(uRelief, 1.0);
    if (uPalette == 0) { // Earth-like
        vec3 sand = vec3(0.62, 0.55, 0.4), grass = vec3(0.13, 0.22, 0.06), forest = vec3(0.05, 0.12, 0.04);
        vec3 dry = vec3(0.35, 0.3, 0.18), rock = vec3(0.33, 0.3, 0.27), snow = vec3(0.92, 0.94, 0.97);
        vec3 c = mix(grass, forest, smoothstep(-0.2, 0.4, n));
        c = mix(c, dry, smoothstep(0.55, 0.85, rel + n * 0.1));
        c = mix(sand, c, smoothstep(uSea + 8.0, uSea + 40.0, h));
        c = mix(c, rock, smoothstep(0.35, 0.55, slope));
        c = mix(c, snow, smoothstep(1.02, 1.1, rel + n * 0.08) * (1.0 - smoothstep(0.55, 0.75, slope)));
        return c;
    } else if (uPalette == 1) { // Mars: iron-oxide dust over dark basalt
        vec3 dust = vec3(0.55, 0.28, 0.13), light = vec3(0.7, 0.45, 0.28), basalt = vec3(0.2, 0.13, 0.1);
        vec3 c = mix(dust, light, smoothstep(-0.3, 0.5, n));
        return mix(c, basalt, smoothstep(0.3, 0.6, slope) * 0.8);
    } else if (uPalette == 2) { // airless regolith
        vec3 c = mix(vec3(0.28, 0.27, 0.26), vec3(0.5, 0.49, 0.47), smoothstep(-0.5, 0.6, n));
        return mix(c, vec3(0.18, 0.17, 0.16), smoothstep(0.35, 0.7, slope));
    } else if (uPalette == 3) { // ice
        vec3 c = mix(vec3(0.72, 0.8, 0.88), vec3(0.95, 0.97, 1.0), smoothstep(-0.4, 0.5, n));
        return mix(c, vec3(0.45, 0.55, 0.65), smoothstep(0.4, 0.7, slope));
    } else if (uPalette == 4) { // lava world
        return mix(vec3(0.08, 0.07, 0.06), vec3(0.2, 0.16, 0.13), smoothstep(-0.4, 0.5, n));
    } else if (uPalette == 5) { // Venus: basaltic plains baked under a thick sky
        return mix(vec3(0.35, 0.25, 0.15), vec3(0.5, 0.38, 0.22), smoothstep(-0.4, 0.5, n));
    }
    // Titan: organic dunes and water-ice bedrock
    return mix(vec3(0.3, 0.2, 0.1), vec3(0.45, 0.35, 0.22), smoothstep(-0.4, 0.5, n));
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 camToP = vec3(vWorld.x, vWorld.y - vDrop, vWorld.z) - cameraPosition;
    float dist = length(camToP);
    // Per-pixel normal from the height field, finer detail close up.
    float e = clamp(dist * 0.002, 1.0, 60.0);
    int detail = dist < 6000.0 ? 8 : 6;
    float h0 = terrainHeight(vWorld.xz, detail);
    float hx = terrainHeight(vWorld.xz + vec2(e, 0.0), detail);
    float hz = terrainHeight(vWorld.xz + vec2(0.0, e), detail);
    vec3 N = normalize(vec3(h0 - hx, e, h0 - hz));
    float slope = 1.0 - N.y;
    float n = tfbm(vWorld.xz * 0.004, 4);
    vec3 albedo = palette(h0, slope, vWorld.xz, n);
    // Fine grain so the ground does not look like plastic up close.
    albedo *= 0.85 + 0.3 * tnoise(vWorld.xz * 0.35) * smoothstep(3000.0, 200.0, dist);

    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 lit = albedo * (uSunColor * ndl + uAmbient * (0.6 + 0.4 * N.y));
    if (uPalette == 4) {
        // Molten rock glows in the lowlands.
        float lava = smoothstep(-0.15, -0.35, h0 / uRelief) * (0.7 + 0.3 * sin(uTime + n * 8.0));
        lit += vec3(1.0, 0.3, 0.05) * lava * 3.0;
    }

    // Aerial perspective: the air between us and the ground scatters light in and dims what is behind.
    vec3 ro = observer();
    vec3 rd = camToP / dist;
    vec3 trans;
    vec3 inscatter = scatter(ro, rd, dist / uPlanetR, trans);
    gl_FragColor = vec4(lit * trans + inscatter, 1.0);
}
`;

// ---------------------------------------------------------------------------

export const WATER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec2 uOffset;
uniform float uSea;
uniform float uPlanetRV;
varying vec3 vWorld;
varying float vDrop;
void main() {
    vec2 xz = position.xz + uOffset;
    vec2 rel = xz - cameraPosition.xz;
    float drop = dot(rel, rel) / (2.0 * uPlanetRV);
    vWorld = vec3(xz.x, uSea, xz.y);
    vDrop = drop;
    gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, uSea - drop, xz.y, 1.0);
    #include <logdepthbuf_vertex>
}
`;

export const WATER_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
#define STEPS 8
#define LIGHT_STEPS 4
${TERRAIN_GLSL}
${ATMOSPHERE_GLSL}
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uTime;
uniform vec3 uDeep;
uniform float uSea;
varying vec3 vWorld;
varying float vDrop;
void main() {
    #include <logdepthbuf_fragment>
    vec3 camToP = vec3(vWorld.x, vWorld.y - vDrop, vWorld.z) - cameraPosition;
    float dist = length(camToP);
    vec3 V = -camToP / dist;
    // Two sets of travelling waves; their slopes perturb the normal, fading with distance.
    vec2 p = vWorld.xz;
    float fade = smoothstep(20000.0, 300.0, dist);
    vec2 g = vec2(0.0);
    g += vec2(cos(p.x * 0.05 + uTime * 1.3), cos(p.y * 0.043 + uTime * 1.1)) * 0.06;
    g += vec2(tnoise(p * 0.02 + uTime * 0.05), tnoise(p.yx * 0.021 - uTime * 0.04)) * 0.12;
    g += vec2(tnoise(p * 0.2 + uTime * 0.3), tnoise(p.yx * 0.19 - uTime * 0.25)) * 0.05;
    vec3 N = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
    vec3 R = reflect(-V, N);
    float cosT = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
    float glint = pow(max(dot(R, uSunDir), 0.0), 900.0) * 60.0;
    // Shallow water shows the sea floor.
    float depth = uSea - terrainHeight(vWorld.xz, 4);
    vec3 body = mix(uDeep * 3.0, uDeep, smoothstep(0.0, 40.0, depth)) * (uAmbient + uSunColor * max(uSunDir.y, 0.0) * 0.5);
    vec3 col = mix(body, sky, fresnel) + uSunColor * glint;
    vec3 trans;
    vec3 inscatter = scatter(observer(), -V, dist / uPlanetR, trans);
    gl_FragColor = vec4(col * trans + inscatter, 1.0);
}
`;

export const ATMO_SHELL_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
#define STEPS 12
#define LIGHT_STEPS 6
${ATMOSPHERE_GLSL}
uniform vec3 uCamLocal;   // camera relative to the planet centre, planet radii (computed in double precision)
uniform float uExposure;
varying vec3 vWorld;
void main() {
    #include <logdepthbuf_fragment>
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 trans;
    vec3 col = scatter(uCamLocal, rd, 1e9, trans);
    gl_FragColor = vec4(col * uExposure, 1.0);
}
`;
