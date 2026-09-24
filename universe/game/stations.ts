// Man-made satellites on their orbits, and portals to other parts of the
// universe. Both hang off a body and move with it.

import * as THREE from 'three';
import { Label, Labels } from '../common';
import { UNIT_KM } from '../physics';

interface BodyLike { name: string; pos: THREE.Vector3; radius: number; radiusKm?: number }

// ---------------------------------------------------------------------------
// Satellites
// ---------------------------------------------------------------------------

export type SatKind = 'station' | 'telescope' | 'comsat' | 'probe';

export interface SatelliteSpec {
    name: string;
    kind: SatKind;
    parent: string;
    /** Height above the surface, km. */
    altKm: number;
    /** Real orbital period, minutes. */
    periodMin: number;
    inclDeg: number;
    nodeDeg: number;
    phase: number;
}

/** Satellites run this many times faster than life, so a low orbit takes minutes, not hours. */
export const SAT_TIME = 10;

const sat = (name: string, kind: SatKind, parent: string, altKm: number, periodMin: number, inclDeg: number, nodeDeg: number, phase: number): SatelliteSpec =>
    ({ name, kind, parent, altKm, periodMin, inclDeg, nodeDeg, phase });

export const SOLAR_SATELLITES: SatelliteSpec[] = [
    sat('МКС', 'station', 'Земля', 420, 92.7, 51.6, 30, 0),
    sat('Тяньгун', 'station', 'Земля', 390, 91.5, 41.5, 120, 2),
    sat('Хаббл', 'telescope', 'Земля', 540, 95.4, 28.5, 200, 4),
    sat('Навстар GPS', 'comsat', 'Земля', 20_200, 718, 55, 60, 1),
    sat('ГЛОНАСС-К', 'comsat', 'Земля', 19_100, 676, 64.8, 180, 3.5),
    sat('Экспресс-АМУ (геостационар)', 'comsat', 'Земля', 35_786, 1436, 0, 0, 5),
    sat('Лунный Gateway', 'station', 'Луна', 5000, 827, 88, 40, 0.5),
    sat('LRO', 'probe', 'Луна', 50, 113, 90, 150, 2.5),
    sat('MRO', 'probe', 'Марс', 300, 112, 93, 20, 1),
    sat('MAVEN', 'probe', 'Марс', 4500, 355, 75, 110, 4),
    sat('Юнона', 'probe', 'Юпитер', 20_000, 251, 90, 70, 2),
];

/** A generated system gets a station and a relay beacon at its first worlds. */
export function generatedSatellites(planets: string[]): SatelliteSpec[] {
    if (!planets.length) return [];
    const list = [sat('Станция «Поток-1»', 'station', planets[0], 900, 105, 30, 20, 0)];
    if (planets[1]) list.push(sat('Ретранслятор «Маяк»', 'comsat', planets[1], 12_000, 480, 10, 90, 2));
    return list;
}

const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2a55, metalness: 0.4, roughness: 0.3, emissive: 0x050a18 });
const foilMat = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.9, roughness: 0.35 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 0.5, roughness: 0.45 });

/** Satellite models in metres, nose along −Z. */
export function makeSatellite(kind: SatKind): THREE.Group {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        g.add(mesh);
        return mesh;
    };
    const cyl = (r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), m);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(x, y, z);
        g.add(mesh);
        return mesh;
    };
    if (kind === 'station') {
        box(110, 3, 3, whiteMat); // the truss
        for (const x of [-48, -34, 34, 48]) for (const y of [1, -1]) box(12, 0.3, 36, panelMat, x, 0, y * 20);
        cyl(2.2, 50, whiteMat, 0, -4, 0);
        cyl(2.2, 22, whiteMat, 0, -4, 0).rotation.set(0, 0, Math.PI / 2);
        box(16, 0.2, 8, whiteMat, 12, -4, 8); // radiators
    } else if (kind === 'telescope') {
        cyl(2.1, 13, whiteMat);
        cyl(2.15, 2, foilMat, 0, 0, 6);
        for (const s of [1, -1]) box(2.6, 0.1, 12, panelMat, s * 4, 0, 0);
    } else if (kind === 'comsat') {
        box(3, 3, 3, foilMat);
        for (const s of [1, -1]) box(14, 0.15, 2.5, panelMat, s * 9, 0, 0);
        const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), whiteMat);
        dish.rotation.x = Math.PI / 2;
        dish.position.z = -2.6;
        g.add(dish);
    } else {
        box(2.5, 2, 2, foilMat);
        box(9, 0.1, 2, panelMat, 5.5, 0, 0);
        const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), whiteMat);
        dish.position.y = 1.4;
        g.add(dish);
    }
    // Navigation lights.
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.2).multiplyScalar(4), toneMapped: false }));
    blink.name = 'blink';
    blink.position.y = 3;
    g.add(blink);
    return g;
}

interface Satellite { spec: SatelliteSpec; mesh: THREE.Group; label: Label; beacon: THREE.Points; axis: THREE.Quaternion }

export class Satellites {
    private list: Satellite[] = [];
    private labels: Labels;

    /** `M` is scene units per metre; models are drawn larger than life (×`boost`) to be seen from afar. */
    constructor(private scene: THREE.Scene, layer: HTMLElement, specs: SatelliteSpec[], M: number, boost = 6) {
        this.labels = new Labels(layer);
        for (const spec of specs) {
            const mesh = makeSatellite(spec.kind);
            mesh.scale.setScalar(M * boost);
            scene.add(mesh);
            const beacon = new THREE.Points(
                new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
                new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.8, 2.2), size: 3, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
            );
            beacon.frustumCulled = false;
            scene.add(beacon);
            const axis = new THREE.Quaternion().setFromEuler(new THREE.Euler((spec.inclDeg * Math.PI) / 180, (spec.nodeDeg * Math.PI) / 180, 0, 'YXZ'));
            this.list.push({ spec, mesh, label: this.labels.add(`🛰 ${spec.name}`, 'sat'), beacon, axis });
        }
    }

    update(realTime: number, bodyByName: (n: string) => BodyLike | undefined, camera: THREE.Camera, w: number, h: number) {
        const v = new THREE.Vector3();
        for (const s of this.list) {
            const p = bodyByName(s.spec.parent);
            s.mesh.visible = s.beacon.visible = !!p;
            if (!p) { s.label.visible = false; continue; }
            const a = s.spec.phase + (2 * Math.PI * realTime * SAT_TIME) / (s.spec.periodMin * 60);
            const r = p.radius * (1 + s.spec.altKm / (p.radiusKm ?? p.radius * UNIT_KM));
            v.set(Math.cos(a) * r, 0, -Math.sin(a) * r).applyQuaternion(s.axis);
            s.mesh.position.copy(p.pos).add(v);
            s.beacon.position.copy(s.mesh.position);
            // Along track, solar wings square to the orbit.
            const along = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)).applyQuaternion(s.axis);
            s.mesh.lookAt(s.mesh.position.clone().add(along));
            const blink = s.mesh.getObjectByName('blink');
            if (blink) blink.visible = Math.sin(realTime * 5 + s.spec.phase * 3) > 0.6;
            s.label.visible = false; // no name tags: the models and their blinking lights speak for themselves
        }
        this.labels.update(camera, w, h);
    }

    dispose() {
        for (const s of this.list) this.scene.remove(s.mesh, s.beacon);
        this.labels.dispose();
    }
}

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

const PORTAL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}`;

const PORTAL_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = atan(vUv.y, vUv.x);
    // A whirlpool: the angle winds tighter towards the centre and turns with time.
    float swirl = a + 3.5 / (r + 0.15) - uTime * 1.2;
    float arms = 0.5 + 0.5 * sin(swirl * 3.0 + noise(vec2(swirl, r * 6.0)) * 3.0);
    float n = noise(vec2(swirl * 2.0, r * 10.0 - uTime));
    float rim = smoothstep(0.75, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
    float core = exp(-r * r * 9.0);
    // Kept below the bloom threshold except at the rim and the eye, so it glows without whiting out the view.
    vec3 c = uColor * (arms * 0.28 + n * 0.12) * (1.0 - r * 0.5) + uColor * rim * 1.6 + vec3(0.9, 0.95, 1.0) * core * 0.7;
    gl_FragColor = vec4(c, 1.0);
}`;

export interface PortalSpec {
    /** Shown on the label: where it leads. */
    title: string;
    /** Body it hangs by. */
    near: string;
    /** Distance from that body's centre, in its radii. */
    distRadii: number;
    angle: number;
    color: number;
    /** Where it goes. */
    go: () => void;
}

export interface Portal { spec: PortalSpec; group: THREE.Group; label: Label; pos: THREE.Vector3; radius: number; material: THREE.ShaderMaterial }

export class Portals {
    readonly list: Portal[] = [];
    private labels: Labels;
    private used = false;
    private prev: THREE.Vector3 | null = null;

    constructor(private scene: THREE.Scene, layer: HTMLElement, specs: PortalSpec[], private radiusOf: (p: PortalSpec) => number) {
        this.labels = new Labels(layer);
        for (const spec of specs) {
            const group = new THREE.Group();
            const material = new THREE.ShaderMaterial({
                vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG,
                uniforms: { uColor: { value: new THREE.Color(spec.color) }, uTime: { value: 0 } },
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
            });
            group.add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), material));
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.035, 12, 128),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.color).multiplyScalar(2.2), toneMapped: false }));
            ring.name = 'ring';
            group.add(ring);
            scene.add(group);
            const label = this.labels.add(`🌀 ${spec.title}`, 'portal');
            this.list.push({ spec, group, label, pos: new THREE.Vector3(), radius: 1, material });
        }
    }

    /** Where a portal is this frame (for the autopilot). */
    place(p: Portal, bodyByName: (n: string) => BodyLike | undefined, starPos: THREE.Vector3): boolean {
        const b = bodyByName(p.spec.near);
        if (!b) return false;
        // On the far side from the star, turned about the body's axis.
        const out = b.pos.clone().sub(starPos).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), p.spec.angle);
        p.pos.copy(b.pos).addScaledVector(out, b.radius * p.spec.distRadii);
        p.radius = this.radiusOf(p.spec);
        p.group.position.copy(p.pos);
        p.group.scale.setScalar(p.radius);
        // Face the body, so the pilot flies out through it.
        p.group.lookAt(b.pos);
        return true;
    }

    update(time: number, pilot: THREE.Vector3, bodyByName: (n: string) => BodyLike | undefined, starPos: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
        for (const p of this.list) {
            const ok = this.place(p, bodyByName, starPos);
            p.group.visible = p.label.visible = ok;
            if (!ok) continue;
            p.material.uniforms.uTime.value = time;
            (p.group.getObjectByName('ring') as THREE.Mesh).rotation.z = time * 0.3;
            p.label.position.copy(p.pos);
            // Through the disk: this frame's path crossed its plane inside the rim (at any speed).
            const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
            const r0 = (this.prev ?? pilot).clone().sub(p.pos), r1 = pilot.clone().sub(p.pos);
            const d0 = r0.dot(normal), d1 = r1.dot(normal);
            // A jump (a teleport, a return from a surface) is not a flight through anything.
            const jump = r0.distanceTo(r1) > p.radius * 40;
            if (!this.used && !jump && d0 !== d1 && d0 * d1 <= 0) {
                const hit = r0.lerp(r1, d0 / (d0 - d1));
                if (hit.length() < p.radius * 0.95) {
                    this.used = true;
                    p.spec.go();
                }
            }
        }
        this.prev = pilot.clone();
        this.labels.update(camera, w, h);
    }

    dispose() {
        for (const p of this.list) this.scene.remove(p.group);
        this.labels.dispose();
    }
}
