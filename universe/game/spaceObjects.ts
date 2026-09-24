// Small bodies of a star system: the asteroid belt and comets at the scale of
// the system, and a field of real rocks and meteoroids around the ship at the
// scale of a dogfight.

import * as THREE from 'three';
import { NOISE } from '../shaders';
import { AU_KM, UNIT_KM } from '../physics';
import { mulberry32 } from '../mandelbrot';

const AU = AU_KM / UNIT_KM; // scene units per AU

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

// ---------------------------------------------------------------------------
// Rocks and meteoroids around the ship. Positions are in km in the combat
// frame (riding with the nearest body), like the enemies, so they can be shot.
// ---------------------------------------------------------------------------

const ROCK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
    vObj = position;
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
}
`;

const ROCK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
void main() {
    #include <logdepthbuf_fragment>
    // Regolith-grey carbonaceous rock with lighter and darker patches and pitted craters.
    vec3 p = vObj * 0.05;
    float n = fbm(p * 2.0);
    float pits = smoothstep(0.55, 0.75, abs(snoise(p * 7.0)));
    vec3 albedo = mix(vec3(0.09, 0.085, 0.08), vec3(0.24, 0.21, 0.18), smoothstep(-0.4, 0.5, n)) * (1.0 - 0.35 * pits);
    // Bump from the same noise, via screen-space derivatives of object-space detail.
    vec3 N = normalize(vNormalW);
    float h = n + 0.3 * pits;
    N = normalize(N - 0.8 * (dFdx(h) * normalize(dFdx(vWorld) + 1e-9) + dFdy(h) * normalize(dFdy(vWorld) + 1e-9)));
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.08;
    gl_FragColor = vec4(albedo * (uSunColor * ndl + vec3(0.02, 0.022, 0.028)) + rim * uSunColor * albedo, 1.0);
}
`;

interface Rock { local: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; radiusKm: number; hp: number }
interface Meteor { local: THREE.Vector3; vel: THREE.Vector3; life: number; line: THREE.Line }

export interface FieldFrame {
    /** km-frame helpers from Combat. */
    toLocal(world: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3 | null;
    toWorld(local: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;
}

export class DebrisField {
    private rocks: Rock[] = [];
    private mesh: THREE.InstancedMesh;
    private meteors: Meteor[] = [];
    private meteorIn = 4;
    private dummy = new THREE.Object3D();
    private material: THREE.ShaderMaterial;
    private rng = mulberry32(99);

    constructor(private scene: THREE.Scene, private kmToUnits: number, private max = 70) {
        const geo = new THREE.IcosahedronGeometry(1000, 3); // metres; scaled per rock
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            const n = Math.sin(v.x * 0.004 + 1.3) * Math.sin(v.y * 0.005 + 0.7) * Math.sin(v.z * 0.0045 + 2.1);
            const n2 = Math.sin(v.x * 0.013) * Math.sin(v.y * 0.011 + 1.1) * Math.sin(v.z * 0.012);
            v.multiplyScalar(1 + 0.28 * n + 0.08 * n2);
            v.y *= 0.72; // potato-shaped
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        geo.computeVertexNormals();
        this.material = new THREE.ShaderMaterial({
            vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG,
            uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunColor: { value: new THREE.Vector3(1.6, 1.55, 1.5) } },
        });
        this.mesh = new THREE.InstancedMesh(geo, this.material, max);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    /** Rocks close enough to be shot at, for the combat's bolt tests. */
    targets(): { local: THREE.Vector3; radiusKm: number; hit: (damage: number) => boolean }[] {
        return this.rocks.map(r => ({
            local: r.local, radiusKm: r.radiusKm,
            hit: (d: number) => { r.hp -= d; return r.hp <= 0; },
        }));
    }

    private place(r: Rock, me: THREE.Vector3, ahead: THREE.Vector3, first: boolean) {
        // New rocks appear out in front, so there is always something coming at you.
        const dir = first ? new THREE.Vector3().randomDirection() : ahead.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.9)).normalize();
        r.local.copy(me).addScaledVector(dir, first ? 3 + this.rng() * 22 : 20 + this.rng() * 6);
        r.vel.randomDirection().multiplyScalar(0.02 + this.rng() * 0.08);
        r.spin.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).multiplyScalar(0.6);
        r.radiusKm = 0.02 + 0.35 * Math.pow(this.rng(), 3);
        r.hp = 30 + r.radiusKm * 600;
    }

    /**
     * Keep `density` rocks around the ship. Returns damage the ship took from
     * collisions this frame, and the rocks destroyed (for score and debris).
     */
    update(dt: number, frame: FieldFrame, shipWorld: THREE.Vector3, shipVelKmS: THREE.Vector3, sunDir: THREE.Vector3, density: number, visible: boolean): { damage: number; broken: THREE.Vector3[] } {
        const out = { damage: 0, broken: [] as THREE.Vector3[] };
        this.material.uniforms.uSunDir.value.copy(sunDir);
        const me = frame.toLocal(shipWorld);
        this.mesh.visible = visible && !!me;
        if (!me || !visible) return out;
        const ahead = shipVelKmS.lengthSq() > 1e-6 ? shipVelKmS.clone().normalize() : new THREE.Vector3(0, 0, -1);
        const want = Math.min(this.max, Math.round(density));
        while (this.rocks.length < want) {
            const r: Rock = { local: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), radiusKm: 0.1, hp: 50 };
            this.place(r, me, ahead, true);
            this.rocks.push(r);
        }
        if (this.rocks.length > want) this.rocks.length = want;
        for (const r of this.rocks) {
            if (r.hp <= 0) { out.broken.push(r.local.clone()); this.place(r, me, ahead, false); }
            r.local.addScaledVector(r.vel, dt);
            r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt;
            const d = r.local.distanceTo(me);
            if (d > 30) this.place(r, me, ahead, false);
            else if (d < r.radiusKm + 0.03) {
                // A collision: the rock breaks, the ship takes damage in proportion to its size.
                out.damage += 15 + r.radiusKm * 120;
                out.broken.push(r.local.clone());
                this.place(r, me, ahead, false);
            }
        }
        this.rocks.forEach((r, i) => {
            this.dummy.position.copy(frame.toWorld(r.local));
            this.dummy.rotation.copy(r.rot);
            this.dummy.scale.setScalar((r.radiusKm * this.kmToUnits) / 1000);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        });
        this.mesh.count = this.rocks.length;
        this.mesh.instanceMatrix.needsUpdate = true;

        // Meteoroids: now and then a pebble streaks past at tens of km/s, glowing.
        this.meteorIn -= dt;
        if (this.meteorIn <= 0) {
            this.meteorIn = 2 + this.rng() * 5;
            const from = me.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(8));
            const to = me.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(2));
            const vel = to.sub(from).normalize().multiplyScalar(25 + this.rng() * 40);
            const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            line.frustumCulled = false;
            this.scene.add(line);
            this.meteors.push({ local: from, vel, life: 0.8, line });
        }
        for (const m of this.meteors) {
            m.life -= dt;
            m.local.addScaledVector(m.vel, dt);
            const head = frame.toWorld(m.local), tailPt = frame.toWorld(m.local.clone().addScaledVector(m.vel, -0.06));
            (m.line.geometry.attributes.position as THREE.BufferAttribute).setXYZ(0, head.x, head.y, head.z);
            (m.line.geometry.attributes.position as THREE.BufferAttribute).setXYZ(1, tailPt.x, tailPt.y, tailPt.z);
            m.line.geometry.attributes.position.needsUpdate = true;
            (m.line.material as THREE.LineBasicMaterial).opacity = Math.min(1, m.life * 3);
        }
        this.meteors = this.meteors.filter(m => {
            if (m.life > 0) return true;
            this.scene.remove(m.line);
            m.line.geometry.dispose();
            (m.line.material as THREE.Material).dispose();
            return false;
        });
        return out;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        for (const m of this.meteors) this.scene.remove(m.line);
    }
}

