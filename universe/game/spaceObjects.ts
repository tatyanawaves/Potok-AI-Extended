// Small bodies of a star system: the asteroid belt and comets, at the scale of
// the system.

import * as THREE from 'three';
import { SCENE_AU } from '../physics';
import { mulberry32 } from '../mandelbrot';

const AU = SCENE_AU; // scene units per (drawn) AU

// ---------------------------------------------------------------------------
// Asteroid belt: thousands of particles on Kepler orbits, moved on the GPU.
// ---------------------------------------------------------------------------

const BELT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aOrbit;   // a (scene units), phase, inclination, node
attribute float aSize;
attribute vec3 aColor;
uniform float uDays;
uniform float uPx;
uniform float uStarMass;
varying vec3 vColor;
varying float vAlpha;
void main() {
    float a = aOrbit.x;
    // Kepler's third law in these units: P (days) = 365.25 · (a / 1 AU)^1.5 / √M.
    float period = 365.25 * pow(a / ${AU.toFixed(3)}, 1.5) / sqrt(uStarMass);
    float M = aOrbit.y + 6.2831853 * uDays / period;
    vec3 p = vec3(cos(M) * a, 0.0, -sin(M) * a);
    float ci = cos(aOrbit.z), si = sin(aOrbit.z);
    p = vec3(p.x, -p.z * si, p.z * ci);
    float cn = cos(aOrbit.w), sn = sin(aOrbit.w);
    p = vec3(cn * p.x - sn * p.z, p.y, sn * p.x + cn * p.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float px = aSize * uPx / max(-mv.z, 1e-6);
    gl_PointSize = clamp(px, 1.0, 3.0);
    vAlpha = clamp(px, 0.15, 1.0);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

const DOT_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vAlpha;
void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * vAlpha * (1.0 - d * d), 1.0);
}
`;

export function makeBelt(inner: number, outer: number, seed: number, count = 7000): THREE.Points {
    const rng = mulberry32(seed);
    const orbit = new Float32Array(count * 4), size = new Float32Array(count), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        // Kirkwood gaps: resonances with the giant planet clear some radii.
        let a = inner + (outer - inner) * rng();
        for (const gap of [2.5, 2.82, 2.95]) if (Math.abs(a / AU - gap) < 0.03 && rng() < 0.85) a = inner + (outer - inner) * rng();
        orbit.set([a, rng() * Math.PI * 2, (rng() - 0.5) * 0.35, rng() * Math.PI * 2], i * 4);
        size[i] = 0.02 + 0.05 * Math.pow(rng(), 3);
        const c = 0.25 + 0.2 * rng(), warm = rng() < 0.6;
        col.set(warm ? [c * 1.1, c * 0.95, c * 0.8] : [c, c, c * 1.05], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
        vertexShader: BELT_VERT, fragmentShader: DOT_FRAG,
        uniforms: { uDays: { value: 0 }, uPx: { value: 800 }, uStarMass: { value: 1 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
}

// ---------------------------------------------------------------------------
// Comets: a nucleus, a glowing coma, a straight blue ion tail blown directly
// away from the star and a curved yellow dust tail that lags along the orbit.
// Both grow as the comet nears the star (sublimation ∝ 1/r²).
// ---------------------------------------------------------------------------

const TAIL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aSeed;     // position along the tail (0..1), sideways spread, speed
uniform vec3 uNucleus;
uniform vec3 uAnti;       // unit vector away from the star
uniform vec3 uLag;        // unit vector opposite to the orbital motion (dust)
uniform float uLen;
uniform float uWidth;
uniform float uCurve;
uniform float uTime;
uniform float uPx;
uniform float uSize;
uniform vec3 uColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
    // Particles stream outward and recycle, so the tail seems to flow.
    float t = fract(aSeed.x + uTime * aSeed.z);
    vec3 axis = normalize(uAnti + uLag * uCurve * t);
    vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec3 up = cross(side, axis);
    float spread = uWidth * (0.05 + t) * aSeed.y;
    vec3 p = uNucleus + axis * uLen * t * t + side * spread * cos(aSeed.y * 40.0) + up * spread * sin(aSeed.y * 40.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uSize * uPx / max(-mv.z, 1e-6) * (0.6 + t), 1.0, 40.0);
    vAlpha = (1.0 - t) * (1.0 - t) * 0.5;
    vColor = uColor;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

const SOFT_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vAlpha;
void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * vAlpha * exp(-d * d * 3.0), 1.0);
}
`;

export interface Comet {
    name: string;
    /** Orbital elements, a in scene units, angles in degrees, M0 at J2000, period in days. */
    a: number; e: number; i: number; node: number; peri: number; M0: number; period: number;
    group: THREE.Group;
    ion: THREE.Points;
    dust: THREE.Points;
    coma: THREE.Mesh;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
}

function tail(count: number, color: [number, number, number], seed: number): THREE.Points {
    const rng = mulberry32(seed);
    const s = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) s.set([rng(), (rng() - 0.5) * 2, 0.05 + 0.08 * rng()], k * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 3));
    const m = new THREE.ShaderMaterial({
        vertexShader: TAIL_VERT, fragmentShader: SOFT_FRAG,
        uniforms: {
            uNucleus: { value: new THREE.Vector3() }, uAnti: { value: new THREE.Vector3(1, 0, 0) }, uLag: { value: new THREE.Vector3() },
            uLen: { value: 1 }, uWidth: { value: 0.1 }, uCurve: { value: 0 }, uTime: { value: 0 }, uPx: { value: 800 },
            uSize: { value: 0.05 }, uColor: { value: new THREE.Vector3(...color) },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
}

const COMA_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uGlow;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
    #include <logdepthbuf_fragment>
    float mu = abs(dot(normalize(vNormalW), normalize(cameraPosition - vWorld)));
    // An optically thin cloud: brightest through its centre.
    gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * pow(mu, 3.0) * uGlow, 1.0);
}
`;

export function makeComet(name: string, aAU: number, e: number, i: number, node: number, peri: number, M0: number, starMass: number, seed: number): Comet {
    const a = aAU * AU;
    const period = 365.25 * Math.pow(aAU, 1.5) / Math.sqrt(starMass);
    const group = new THREE.Group();
    const coma = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}`,
        fragmentShader: COMA_FRAG, uniforms: { uGlow: { value: 1 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const ion = tail(2200, [0.35, 0.6, 1.3], seed);
    const dust = tail(2600, [1.2, 1.0, 0.7], seed + 1);
    group.add(coma, ion, dust);
    return { name, a, e, i, node, peri, M0, period, group, ion, dust, coma, pos: new THREE.Vector3(), prev: new THREE.Vector3() };
}

export function updateComet(c: Comet, pos: THREE.Vector3, starPos: THREE.Vector3, time: number, px: number) {
    c.prev.copy(c.pos);
    c.pos.copy(pos);
    const rAU = Math.max(pos.distanceTo(starPos) / AU, 0.05);
    const activity = Math.min(3, 1 / (rAU * rAU)); // sublimation ∝ 1/r²
    const anti = pos.clone().sub(starPos).normalize();
    const lag = c.prev.lengthSq() > 0 ? c.prev.clone().sub(pos).normalize() : new THREE.Vector3();
    c.coma.position.copy(pos);
    c.coma.scale.setScalar(0.25 * activity + 0.01); // ~10⁵ km comae near perihelion
    (c.coma.material as THREE.ShaderMaterial).uniforms.uGlow.value = 0.15 + 0.35 * activity;
    for (const [t, len, width, curve, size] of [[c.ion, 25, 0.8, 0, 0.12], [c.dust, 14, 2.2, 1.4, 0.2]] as const) {
        const u = (t.material as THREE.ShaderMaterial).uniforms;
        u.uNucleus.value.copy(pos);
        u.uAnti.value.copy(anti);
        u.uLag.value.copy(lag);
        u.uLen.value = len * activity;
        u.uWidth.value = width * activity;
        u.uCurve.value = curve;
        u.uTime.value = time;
        u.uPx.value = px;
        u.uSize.value = size * Math.max(activity, 0.2);
        t.visible = activity > 0.02;
    }
}
