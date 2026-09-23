import * as THREE from 'three';
import {
    Action, disposeObject, escapeHtml, Label, Labels, Level, LevelHost, pickPoint, pixelScale, row, spriteMaterial, starfield,
} from '../common';
import { GalaxySpec, generateSystem, mulberry32, PlanetKind, SystemSpec } from '../mandelbrot';
import {
    AU_KM, blackbodyRGB, C_KM_S, daysSinceJ2000, DAY_S, equilibriumTemperature, escapeVelocity, EARTH_PER_SUN_MASS,
    fmtDistanceKm, fmtDuration, fmtNum, frostLine, habitableZone, mainSequence, OrbitalElements, orbitalPosition,
    orbitPointAtE, EARTH_MARS_FLIGHT_S, EARTH_MARS_GAP_KM, R_EARTH_KM, R_SUN_KM, solveKepler, spectralClass,
    surfaceGravity, UNIT_KM, visViva,
} from '../physics';
import { BodyData, SOLAR_SYSTEM, SUN } from '../solarSystem';
import {
    PLANET_FRAG, PLANET_VERT, RING_FRAG, RING_VERT, STAR_FRAG, WELL_FRAG, WELL_VERT,
} from '../shaders';

type Kind = PlanetKind | 'moon' | 'star';

interface Body {
    name: string;
    kind: Kind;
    radius: number; // scene units
    radiusKm: number;
    massEarth: number;
    parent: Body | null;
    el: OrbitalElements | null; // a in scene units
    aKm: number;
    albedo: number;
    tilt: number;
    dayDays: number;
    group: THREE.Group;
    tiltHolder: THREE.Object3D;
    mesh: THREE.Mesh;
    material: THREE.ShaderMaterial;
    ring?: THREE.Mesh;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    vel: THREE.Vector3; // scene units per real second
    label: Label;
    orbitLine?: THREE.LineLoop;
    color: [number, number, number];
}

const KIND_ID: Record<Kind, number> = {
    rocky: 0, venus: 1, earth: 2, desert: 3, gas: 4, 'ice-giant': 5, lava: 6, ice: 7, moon: 8, star: -1,
};
const KIND_RU: Record<Kind, string> = {
    rocky: 'каменистая, без атмосферы', venus: 'плотная атмосфера (как Венера)', earth: 'землеподобная, океаны',
    desert: 'пустынная (как Марс)', gas: 'газовый гигант', 'ice-giant': 'ледяной гигант', lava: 'лавовый мир',
    ice: 'ледяной мир', moon: 'спутник', star: 'звезда',
};

interface Look { a: [number, number, number]; b: [number, number, number]; c: [number, number, number]; atmo: [number, number, number]; atmoStrength: number }

function lookFor(kind: Kind, name: string, seed: number): Look {
    const rng = mulberry32(seed);
    const j = (x: number) => x * (0.85 + 0.3 * rng());
    switch (name) {
        case 'Сатурн': return { a: [0.88, 0.8, 0.58], b: [0.76, 0.64, 0.43], c: [0.85, 0.74, 0.52], atmo: [0.8, 0.75, 0.5], atmoStrength: 0.3 };
        case 'Уран': return { a: [0.62, 0.86, 0.9], b: [0.56, 0.8, 0.86], c: [0, 0, 0], atmo: [0.5, 0.85, 1], atmoStrength: 0.5 };
        case 'Нептун': return { a: [0.2, 0.38, 0.85], b: [0.3, 0.5, 0.95], c: [0, 0, 0], atmo: [0.35, 0.55, 1], atmoStrength: 0.6 };
        case 'Ио': return { a: [0.75, 0.65, 0.25], b: [0.95, 0.88, 0.5], c: [0, 0, 0], atmo: [0, 0, 0], atmoStrength: 0 };
        case 'Титан': return { a: [0.7, 0.5, 0.2], b: [0.85, 0.62, 0.3], c: [0, 0, 0], atmo: [0.9, 0.6, 0.25], atmoStrength: 1.2 };
        case 'Меркурий': return { a: [0.28, 0.26, 0.24], b: [0.55, 0.52, 0.48], c: [0, 0, 0], atmo: [0, 0, 0], atmoStrength: 0 };
    }
    switch (kind) {
        case 'venus': return { a: [0.8, 0.66, 0.42], b: [0.96, 0.9, 0.72], c: [0, 0, 0], atmo: [0.95, 0.85, 0.6], atmoStrength: 0.8 };
        case 'earth': return { a: [0, 0, 0], b: [0.3, 0.45, 0.7], c: [0, 0, 0], atmo: [0.3, 0.55, 1], atmoStrength: 1.3 };
        case 'desert': return { a: [j(0.45), j(0.18), 0.07], b: [j(0.76), j(0.42), 0.2], c: [1, 0, 0], atmo: [0.85, 0.55, 0.4], atmoStrength: 0.3 };
        case 'gas': return {
            a: [j(0.86), j(0.76), j(0.6)], b: [j(0.6), j(0.42), j(0.28)], c: [j(0.76), j(0.36), j(0.2)],
            atmo: [0.6, 0.7, 0.9], atmoStrength: 0.35,
        };
        case 'ice-giant': return { a: [j(0.3), j(0.55), 0.9], b: [j(0.45), j(0.7), 0.95], c: [0, 0, 0], atmo: [0.4, 0.7, 1], atmoStrength: 0.55 };
        case 'moon': case 'rocky': return { a: [0.3, 0.29, 0.28], b: [0.62, 0.6, 0.57], c: [0, 0, 0], atmo: [0, 0, 0], atmoStrength: 0 };
        case 'ice': return { a: [0.7, 0.8, 0.9], b: [0.95, 0.97, 1], c: [0, 0, 0], atmo: [0.6, 0.8, 1], atmoStrength: 0.2 };
        default: return { a: [0.1, 0.08, 0.06], b: [0.3, 0.15, 0.08], c: [0, 0, 0], atmo: [1, 0.4, 0.1], atmoStrength: 0.4 };
    }
}

/** Kinematic model of the ship: cruise speed from the chosen scale, and a brisk but finite acceleration. */
const ACCEL = 6; // scene units per s²  (the whole speed-up takes under half a second)
const toThree = (e: number[], out: THREE.Vector3) => out.set(e[0], e[2], -e[1]);

export class StarSystemLevel implements Level {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(60, 1, 1e-7, 1e7);
    readonly title: string;
    readonly bloom = { strength: 0.7, radius: 0.5, threshold: 0.8 };
    readonly help = 'W/S — вперёд/назад · A/D — вбок · R/F — вверх/вниз · Q/E — крен · Shift — ×10 · Пробел — стоп · мышь — обзор · клик по планете — выбрать · двойной клик — лететь';

    private system: SystemSpec | null = null;
    private starMassSun: number;
    private starT: number;
    private starL: number;
    private starColor: [number, number, number];
    private bodies: Body[] = [];
    private sprites!: THREE.Points;
    private labels: Labels;
    private sky: THREE.Points;
    private well: THREE.Mesh;
    private kepler: THREE.Group = new THREE.Group();
    private sphere = new THREE.SphereGeometry(1, 96, 64);
    private tDays: number;
    private timeScale = 3600;
    private width = 1;
    private height = 1;
    private realTime = 0;

    // Ship
    private mode: 'free' | 'auto' | 'orbit' = 'orbit';
    private target: Body | null = null;
    private orbitOffset = new THREE.Vector3();
    private velocity = new THREE.Vector3();
    private speed = 0;
    private keys = new Set<string>();
    private dragging = false;
    private lastPointer = { x: 0, y: 0 };
    private flightStart = 0;
    private flightFrom = '';
    private lastFlight = '';
    private showOrbits = true;
    /** The scale: seconds to cross the 78 million km between Earth and Mars at an average opposition. */
    private flightSeconds = EARTH_MARS_FLIGHT_S;
    private get cruise() { return EARTH_MARS_GAP_KM / UNIT_KM / this.flightSeconds; }

    private onKeyDown = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
        this.keys.add(e.code);
        if (e.code === 'Space') { this.mode = 'free'; this.velocity.set(0, 0, 0); this.speed = 0; }
        if (e.code === 'Enter' && this.target) this.flyTo(this.target);
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF'].includes(e.code) && this.mode !== 'free') this.mode = 'free';
    };
    private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    private onDown = (e: PointerEvent) => { this.dragging = true; this.lastPointer = { x: e.clientX, y: e.clientY }; };
    private onUp = () => { this.dragging = false; };
    private onMove = (e: PointerEvent) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        if (this.mode === 'orbit' && this.target) {
            const s = new THREE.Spherical().setFromVector3(this.orbitOffset);
            s.theta -= dx * 0.005;
            s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi - dy * 0.005));
            this.orbitOffset.setFromSpherical(s);
        } else {
            const q = new THREE.Quaternion();
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.003);
            this.camera.quaternion.multiply(q);
            q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.003);
            this.camera.quaternion.multiply(q);
        }
    };
    private onWheel = (e: WheelEvent) => {
        if (this.mode === 'orbit' && this.target) {
            const min = this.target.radius * 1.2;
            const len = Math.max(min, this.orbitOffset.length() * Math.exp(e.deltaY * 0.001));
            this.orbitOffset.setLength(len);
        }
    };
    private onDbl = () => { if (this.target) this.flyTo(this.target); };

    constructor(private host: LevelHost, private galaxy: GalaxySpec, star: { seed: number; mass: number } | 'sun') {
        this.labels = new Labels(host.labelLayer);
        this.tDays = daysSinceJ2000(new Date());

        let bodies: BodyData[];
        let starRadiusKm: number;
        if (star === 'sun') {
            this.title = 'Солнечная система';
            this.starMassSun = 1; this.starT = SUN.T; this.starL = SUN.L; starRadiusKm = SUN.radiusKm;
            bodies = SOLAR_SYSTEM;
        } else {
            const sys = generateSystem(star.seed, star.mass);
            this.system = sys;
            this.title = `Система ${sys.name}`;
            this.starMassSun = sys.starMass; this.starT = sys.T; this.starL = sys.L; starRadiusKm = sys.R * R_SUN_KM;
            bodies = sys.planets.map(p => ({
                name: `${sys.name} ${p.name}`, kind: p.kind, aKm: p.aAU * AU_KM, e: p.e, i: p.i, node: p.node, peri: p.peri,
                M0: p.M0, periodDays: p.periodDays, radiusKm: p.radiusEarth * R_EARTH_KM, massEarth: p.massEarth,
                tilt: p.tilt, dayDays: p.dayDays, albedo: 0.3, rings: p.rings, seed: p.seed,
            }));
        }
        this.starColor = blackbodyRGB(this.starT);

        this.addStar(starRadiusKm);
        for (const b of bodies) {
            const planet = this.addBody(b, this.bodies[0]);
            for (const m of b.moons ?? []) this.addBody(m, planet);
        }
        this.buildSprites();

        this.sky = starfield(1e5, 9000, galaxy.seed ^ 0x51c);
        this.scene.add(this.sky);

        const outer = Math.max(...this.bodies.filter(b => b.parent === this.bodies[0]).map(b => b.el!.a));
        this.well = this.buildWell(outer * 1.3);
        this.well.visible = false;
        this.scene.add(this.well);
        this.scene.add(this.kepler);

        this.updatePositions(0);
        // Start parked next to Earth, or next to the first planet of a new system.
        const home = this.bodies.find(b => b.name === 'Земля') ?? this.bodies.find(b => b.kind === 'earth') ?? this.bodies[1] ?? this.bodies[0];
        this.target = home;
        const sunward = home.pos.clone().negate().normalize();
        this.orbitOffset.copy(sunward.multiplyScalar(home.radius * 3.2)).add(new THREE.Vector3(0, home.radius * 0.8, 0))
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75);
        this.mode = 'orbit';

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        host.canvas.addEventListener('pointerdown', this.onDown);
        window.addEventListener('pointerup', this.onUp);
        window.addEventListener('pointermove', this.onMove);
        host.canvas.addEventListener('wheel', this.onWheel, { passive: true });
        host.canvas.addEventListener('dblclick', this.onDbl);
    }

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    private addStar(radiusKm: number) {
        const group = new THREE.Group();
        const material = new THREE.ShaderMaterial({
            vertexShader: PLANET_VERT, fragmentShader: STAR_FRAG,
            uniforms: { uColor: { value: new THREE.Vector3(...this.starColor) }, uTime: { value: 0 }, uSeed: { value: 3 } },
        });
        const mesh = new THREE.Mesh(this.sphere, material);
        const radius = radiusKm / UNIT_KM;
        mesh.scale.setScalar(radius);
        group.add(mesh);
        this.scene.add(group);
        const name = this.system ? this.system.name : SUN.name;
        const body: Body = {
            name, kind: 'star', radius, radiusKm, massEarth: this.starMassSun * EARTH_PER_SUN_MASS, parent: null, el: null,
            aKm: 0, albedo: 0, tilt: 7.25, dayDays: 25.4, group, tiltHolder: group, mesh, material,
            pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
            label: this.labels.add(name, 'star', () => this.select(body)), color: this.starColor,
        };
        this.bodies.push(body);
    }

    private addBody(d: BodyData, parent: Body): Body {
        const kind = d.kind as Kind;
        const look = lookFor(kind, d.name, d.seed);
        const radius = d.radiusKm / UNIT_KM;
        const group = new THREE.Group();
        const tiltHolder = new THREE.Object3D();
        tiltHolder.rotation.z = (d.tilt * Math.PI) / 180;
        group.add(tiltHolder);
        const hasRing = !!d.rings;
        const material = new THREE.ShaderMaterial({
            vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
            uniforms: {
                uSun: { value: new THREE.Vector3() },
                uStarColor: { value: new THREE.Vector3(...this.starColor) },
                uStarIntensity: { value: 1 },
                uKind: { value: KIND_ID[d.name === 'Европа' ? 'ice' : kind] },
                uSeed: { value: d.seed % 1000 },
                uTime: { value: 0 },
                uColA: { value: new THREE.Vector3(...look.a) },
                uColB: { value: new THREE.Vector3(...look.b) },
                uColC: { value: new THREE.Vector3(...look.c) },
                uAtmo: { value: new THREE.Vector3(...look.atmo) },
                uAtmoStrength: { value: look.atmoStrength },
                uRing: { value: new THREE.Vector4(0, 0, 0, 0) },
                uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
                uCenter: { value: new THREE.Vector3() },
            },
        });
        const mesh = new THREE.Mesh(this.sphere, material);
        mesh.scale.setScalar(radius);
        tiltHolder.add(mesh);

        let ring: THREE.Mesh | undefined;
        if (hasRing) {
            const saturnLike = d.name === 'Сатурн' || (kind === 'gas' && d.seed % 2 === 0);
            const inner = radius * (saturnLike ? 1.24 : 1.6), outer = radius * (saturnLike ? 2.27 : 2.0);
            const rmat = new THREE.ShaderMaterial({
                vertexShader: RING_VERT, fragmentShader: RING_FRAG,
                uniforms: {
                    uSun: { value: new THREE.Vector3() }, uStarColor: { value: new THREE.Vector3(...this.starColor) },
                    uStarIntensity: { value: 1 }, uPlanet: { value: new THREE.Vector3() }, uPlanetR: { value: radius },
                    uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: d.seed % 100 },
                    uDensity: { value: saturnLike ? 1.1 : 0.3 },
                    uColor: { value: new THREE.Vector3(...(saturnLike ? [0.85, 0.78, 0.62] : [0.5, 0.55, 0.6])) },
                },
                transparent: true, side: THREE.DoubleSide, depthWrite: false,
            });
            ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 256, 1), rmat);
            ring.rotation.x = -Math.PI / 2;
            tiltHolder.add(ring);
            material.uniforms.uRing.value.set(inner, outer, 1, 0);
        }

        this.scene.add(group);
        const el: OrbitalElements = {
            a: d.aKm / UNIT_KM, e: d.e, i: d.i, node: d.node, peri: d.peri, M0: d.M0, period: d.periodDays,
        };
        const body: Body = {
            name: d.name, kind, radius, radiusKm: d.radiusKm, massEarth: d.massEarth, parent, el, aKm: d.aKm,
            albedo: d.albedo, tilt: d.tilt, dayDays: d.dayDays, group, tiltHolder, mesh, material, ring,
            pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
            label: this.labels.add(d.name, kind === 'moon' ? 'moon' : 'planet', () => this.select(body)),
            color: look.b,
        };
        body.orbitLine = this.buildOrbit(el, kind === 'moon' ? 0.15 : 0.22, look.b);
        (kind === 'moon' ? parent.group : this.scene).add(body.orbitLine);
        this.bodies.push(body);
        return body;
    }

    private buildOrbit(el: OrbitalElements, opacity: number, color: [number, number, number]): THREE.LineLoop {
        const n = 512;
        const pos = new Float32Array(n * 3);
        const e = [0, 0, 0];
        const v = new THREE.Vector3();
        for (let k = 0; k < n; k++) {
            orbitPointAtE(el, (k / n) * Math.PI * 2, e);
            toThree(e, v);
            pos.set([v.x, v.y, v.z], k * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const c = new THREE.Color(0.25 + color[0] * 0.5, 0.25 + color[1] * 0.5, 0.3 + color[2] * 0.5);
        return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false }));
    }

    private buildSprites() {
        const n = this.bodies.length;
        const g = new THREE.BufferGeometry();
        const col = new Float32Array(n * 3), size = new Float32Array(n), radius = new Float32Array(n), glow = new Float32Array(n);
        this.bodies.forEach((b, i) => {
            const star = b.kind === 'star';
            const k = star ? 8 : 1.2;
            col.set([b.color[0] * k, b.color[1] * k, b.color[2] * k], i * 3);
            size[i] = star ? 14 : b.kind === 'moon' ? 2.5 : 5;
            radius[i] = b.radius;
            glow[i] = star ? 7 : 0;
        });
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        g.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
        g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
        this.sprites = new THREE.Points(g, spriteMaterial());
        this.sprites.frustumCulled = false;
        this.sprites.renderOrder = 5;
        this.scene.add(this.sprites);
    }

    /** The Newtonian potential Φ = −Σ GMᵢ/rᵢ drawn as a rubber sheet under the orbits. */
    private buildWell(size: number): THREE.Mesh {
        const g = new THREE.PlaneGeometry(size * 2, size * 2, 320, 320);
        g.rotateX(-Math.PI / 2);
        const soft = size * 0.02;
        const m = new THREE.ShaderMaterial({
            vertexShader: WELL_VERT, fragmentShader: WELL_FRAG,
            uniforms: {
                uMasses: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
                uDepth: { value: 0.18 * size * soft },
                uSoft: { value: soft },
                uCell: { value: size / 40 },
            },
            transparent: true, depthWrite: false, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.frustumCulled = false;
        mesh.position.y = -size * 0.002;
        return mesh;
    }

    private showKepler(body: Body) {
        disposeObject(this.kepler);
        this.kepler.clear();
        if (!body.el || body.parent?.kind !== 'star') return;
        const sectors = 12;
        const e = [0, 0, 0];
        const v = new THREE.Vector3();
        for (let s = 0; s < sectors; s++) {
            const pts: number[] = [0, 0, 0];
            const steps = 24;
            for (let k = 0; k <= steps; k++) {
                const M = ((s + k / steps) / sectors) * Math.PI * 2;
                orbitPointAtE(body.el, solveKepler(M, body.el.e), e);
                toThree(e, v);
                pts.push(v.x, v.y, v.z);
            }
            const idx: number[] = [];
            for (let k = 1; k <= steps; k++) idx.push(0, k, k + 1);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            g.setIndex(idx);
            const color = s % 2 ? 0x3a7bff : 0xff7a3a;
            this.kepler.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
            })));
        }
    }

    // -----------------------------------------------------------------------
    // Simulation
    // -----------------------------------------------------------------------

    private updatePositions(dt: number) {
        const e = [0, 0, 0];
        const v = new THREE.Vector3();
        for (const b of this.bodies) {
            b.prev.copy(b.pos);
            if (b.el && b.parent) {
                orbitalPosition(b.el, this.tDays, e);
                b.pos.copy(toThree(e, v)).add(b.parent.pos);
            }
            b.group.position.copy(b.pos);
            if (dt > 0) b.vel.subVectors(b.pos, b.prev).divideScalar(dt);
            // Spin about the (tilted) axis; sidereal day in days.
            b.mesh.rotation.y = ((this.tDays / b.dayDays) % 1) * Math.PI * 2;
        }
    }

    private nearestSurface(p: THREE.Vector3): { body: Body; dist: number } {
        let best = this.bodies[0], bestD = Infinity;
        for (const b of this.bodies) {
            const d = p.distanceTo(b.pos) - b.radius;
            if (d < bestD) { bestD = d; best = b; }
        }
        return { body: best, dist: bestD };
    }

    private parkDistance(b: Body) {
        return b.radius * (b.kind === 'star' ? 4 : 3.5);
    }

    select(b: Body) {
        this.target = b;
        if (this.keplerOn) this.showKepler(b);
        this.host.toast(`Цель: ${b.name}. Двойной клик или Enter — лететь`);
    }

    flyTo(b: Body) {
        this.target = b;
        if (this.keplerOn) this.showKepler(b);
        if (this.camera.position.distanceTo(b.pos) - this.parkDistance(b) < b.radius * 0.5) {
            this.enterOrbit(b);
            return;
        }
        this.mode = 'auto';
        this.flightStart = this.realTime;
        const near = this.nearestSurface(this.camera.position);
        this.flightFrom = near.body.name;
        this.speed = Math.min(this.speed, this.cruise);
    }

    private enterOrbit(b: Body) {
        this.mode = 'orbit';
        this.target = b;
        this.orbitOffset.subVectors(this.camera.position, b.pos);
        this.speed = 0;
        this.velocity.set(0, 0, 0);
    }

    /** Jump to the next closest approach of Earth and Mars (an opposition). */
    private toOpposition() {
        const earth = this.bodies.find(b => b.name === 'Земля')!, mars = this.bodies.find(b => b.name === 'Марс')!;
        const a = [0, 0, 0], c = [0, 0, 0];
        const dist = (t: number) => {
            orbitalPosition(earth.el!, t, a); orbitalPosition(mars.el!, t, c);
            return Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
        };
        let bestT = this.tDays + 1, bestD = Infinity;
        for (let t = this.tDays + 1; t < this.tDays + 800; t += 1) {
            const d = dist(t);
            if (d < bestD) { bestD = d; bestT = t; }
        }
        this.tDays = bestT;
        this.updatePositions(0);
        this.host.toast(`Противостояние: ${this.dateString()}, Земля–Марс ${fmtDistanceKm(bestD * UNIT_KM)}`);
    }

    private earthToMars() {
        const earth = this.bodies.find(b => b.name === 'Земля')!, mars = this.bodies.find(b => b.name === 'Марс')!;
        const dir = new THREE.Vector3().subVectors(mars.pos, earth.pos).normalize();
        const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
        this.camera.position.copy(earth.pos).addScaledVector(dir, -earth.radius * 4).addScaledVector(side, earth.radius * 1.5);
        this.camera.lookAt(mars.pos);
        this.speed = 0;
        this.flyTo(mars);
    }

    private keplerOn = false;

    actions(): Action[] {
        const list: Action[] = [];
        if (this.target && this.mode !== 'auto') list.push({ label: `▶ Лететь: ${this.target.name}`, run: () => this.flyTo(this.target!) });
        if (this.target && this.mode === 'auto') list.push({ label: '■ Стоп', run: () => { this.mode = 'free'; this.speed = 0; } });
        if (!this.system) {
            list.push({ label: '🚀 Земля → Марс', title: 'Масштаб подобран так, что перелёт между орбитами занимает 30 секунд', run: () => this.earthToMars() });
            list.push({ label: '⏩ К противостоянию', title: 'Перемотать время к ближайшему сближению Земли и Марса', run: () => this.toOpposition() });
        }
        for (const sec of [30, 90]) {
            list.push({
                label: `Масштаб: ${sec} с до Марса`, title: 'Сколько секунд лететь 78 млн км между Землёй и Марсом',
                run: () => { this.flightSeconds = sec; }, active: () => this.flightSeconds === sec,
            });
        }
        list.push({ label: '⊙ Вид сверху', run: () => this.topView() });
        list.push({ label: 'Орбиты', run: () => { this.showOrbits = !this.showOrbits; }, active: () => this.showOrbits });
        list.push({ label: 'Гравитация', title: 'Потенциал Ньютона −GM/r как прогиб «резинового листа»', run: () => { this.well.visible = !this.well.visible; }, active: () => this.well.visible });
        list.push({
            label: '2-й закон Кеплера', title: 'Секторы, заметаемые за равные промежутки времени',
            run: () => { this.keplerOn = !this.keplerOn; if (this.keplerOn && this.target) this.showKepler(this.target); else { disposeObject(this.kepler); this.kepler.clear(); } },
            active: () => this.keplerOn,
        });
        const scales: [number, string][] = [[0, '⏸'], [1, '1 с/с'], [3600, '1 ч/с'], [86_400, '1 сут/с'], [864_000, '10 сут/с']];
        for (const [s, l] of scales) list.push({ label: l, title: 'Скорость течения времени', run: () => { this.timeScale = s; }, active: () => this.timeScale === s });
        return list;
    }

    targets(): Action[] {
        return this.bodies.map(b => ({
            label: `${b.kind === 'moon' ? '  · ' : ''}${b.name}`,
            run: () => { this.select(b); this.flyTo(b); },
        }));
    }

    private topView() {
        const outer = Math.max(...this.bodies.filter(b => b.parent?.kind === 'star').map(b => b.el!.a));
        const inner = Math.min(outer, 2.2 * AU_KM / UNIT_KM);
        this.target = this.bodies[0];
        this.mode = 'orbit';
        this.orbitOffset.set(0, inner * 2.2, inner * 0.6);
    }

    private dateString() {
        const d = new Date(Date.UTC(2000, 0, 1, 12) + this.tDays * DAY_S * 1000);
        return d.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    info(): string {
        const L = this.starL;
        let html = row('Дата', this.dateString());
        html += row('Звезда', `${spectralClass(this.starT)}, ${fmtNum(this.starT)} K, ${fmtNum(L)} L☉`);
        const hz = habitableZone(L);
        html += row('Зона обитаемости', `${fmtNum(hz[0])}–${fmtNum(hz[1])} а.е.`);
        html += row('Снеговая линия', `${fmtNum(frostLine(L))} а.е.`);
        html += `<h3>Масштаб</h3>`;
        const cruiseKms = this.cruise * UNIT_KM;
        html += row('Крейсерская скорость', `${fmtNum(cruiseKms / 1e6)} млн км/с ≈ ${fmtNum(cruiseKms / C_KM_S)} c`);
        html += row('Земля → Марс (среднее противостояние, 78 млн км)', `${this.flightSeconds} с полёта`);
        html += row('Размеры планет', 'реальные');
        if (this.system) {
            html += `<p>Система выведена из орбиты z → z² + c точки c = ${this.system.c[0].toFixed(3)} ${this.system.c[1] >= 0 ? '+' : '−'} ${Math.abs(this.system.c[1]).toFixed(3)}i
            у границы множества Мандельброта: время ухода — число планет, |z| — шаг орбит, arg z — фаза.
            Соседи разнесены не меньше чем на 10 взаимных радиусов Хилла, иначе система неустойчива.</p>`;
        }
        const t = this.target;
        if (t) {
            html += `<h3>${escapeHtml(t.name)}</h3>`;
            html += row('Тип', KIND_RU[t.kind]);
            const dist = Math.max(0, this.camera.position.distanceTo(t.pos) - t.radius) * UNIT_KM;
            html += row('До поверхности', fmtDistanceKm(dist));
            html += row('Свет идёт', fmtDuration(dist / C_KM_S));
            html += row('Нам лететь', fmtDuration(this.eta(t)));
            if (t.kind === 'star') {
                const st = mainSequence(this.starMassSun);
                html += row('Масса', `${fmtNum(this.starMassSun)} M☉`);
                html += row('Радиус', `${fmtNum(st.R)} R☉ = ${fmtNum(t.radiusKm)} км`);
            } else if (t.el && t.parent) {
                const rKm = t.pos.distanceTo(t.parent.pos) * UNIT_KM;
                const mu = t.parent.kind === 'star' ? this.starMassSun : (t.parent.massEarth + t.massEarth) / EARTH_PER_SUN_MASS;
                html += row('Большая полуось', t.parent.kind === 'star' ? `${fmtNum(t.aKm / AU_KM)} а.е.` : fmtDistanceKm(t.aKm));
                html += row('Эксцентриситет', fmtNum(t.el.e));
                html += row('Период (3-й закон Кеплера)', fmtDuration(t.el.period * DAY_S));
                html += row('Скорость сейчас (vis-viva)', `${fmtNum(visViva(rKm, t.aKm, mu))} км/с`);
                html += row('Радиус', `${fmtNum(t.radiusKm)} км`);
                const mE = t.massEarth, rE = t.radiusKm / R_EARTH_KM;
                html += row('Масса', `${fmtNum(mE)} M⊕`);
                html += row('Гравитация на поверхности', `${fmtNum(surfaceGravity(mE, rE))} м/с²`);
                html += row('Вторая космическая', `${fmtNum(escapeVelocity(mE, rE))} км/с`);
                const star = this.bodies[0];
                const dAU = t.pos.distanceTo(star.pos) * UNIT_KM / AU_KM;
                html += row('Освещённость', `${fmtNum(1361 * L / (dAU * dAU))} Вт/м²`);
                html += row('Равновесная температура', `${fmtNum(equilibriumTemperature(L, dAU, t.albedo))} K`);
                html += row('Сутки', fmtDuration(Math.abs(t.dayDays) * DAY_S) + (t.dayDays < 0 ? ' (ретроградно)' : ''));
            }
            if (this.keplerOn && t.el && t.parent?.kind === 'star') {
                html += `<p>Каждый сектор заметается за P/12 = ${fmtDuration(t.el.period * DAY_S / 12)}: площади равны, поэтому у перигелия планета быстрее.</p>`;
            }
        }
        if (this.well.visible) html += `<p>Лист прогнут на −GM/r. Массы планет на нём увеличены в 1000 раз, иначе их ямки не видно.</p>`;
        return html;
    }

    private eta(b: Body): number {
        const d = Math.max(0, this.camera.position.distanceTo(b.pos) - this.parkDistance(b));
        const v = this.cruise;
        const dRamp = (v * v) / ACCEL; // accelerate + decelerate
        return d < dRamp ? 2 * Math.sqrt(d / ACCEL) : d / v + v / ACCEL;
    }

    status(): string {
        const kms = this.speed * UNIT_KM;
        const speed = kms <= 0 ? '0' : `${kms >= 1e6 ? `${fmtNum(kms / 1e6)} млн` : fmtNum(kms)} км/с (${fmtNum(kms / C_KM_S)} c)`;
        let s = `Скорость: ${speed}`;
        if (this.mode === 'auto' && this.target) {
            s += ` · автопилот → ${this.target.name} · в пути ${(this.realTime - this.flightStart).toFixed(1)} с · осталось ≈ ${fmtDuration(this.eta(this.target))}`;
        } else if (this.mode === 'orbit' && this.target) {
            s += ` · на орбите: ${this.target.name}`;
        } else {
            s += ' · свободный полёт';
        }
        if (this.lastFlight) s += ` · ${this.lastFlight}`;
        return s;
    }

    update(dt: number) {
        this.realTime += dt;
        this.tDays += (dt * this.timeScale) / DAY_S;
        this.updatePositions(dt);
        this.fly(dt);

        const star = this.bodies[0];
        const px = pixelScale(this.camera, this.height);
        const spritePos = this.sprites.geometry.attributes.position as THREE.BufferAttribute;
        const tmp = new THREE.Vector3();
        this.bodies.forEach((b, i) => {
            spritePos.setXYZ(i, b.pos.x, b.pos.y, b.pos.z);
            if (b.kind === 'star') {
                b.material.uniforms.uTime.value = this.realTime;
            } else {
                const u = b.material.uniforms;
                u.uSun.value.copy(star.pos);
                u.uTime.value = this.realTime;
                // Illuminance falls as 1/d²; the view adapts like an eye (a gentle power law).
                const dAU = Math.max(b.pos.distanceTo(star.pos) * UNIT_KM / AU_KM, 0.01);
                const intensity = 1.05 * Math.pow(this.starL / (dAU * dAU), 0.3);
                u.uStarIntensity.value = intensity;
                u.uCenter.value.copy(b.pos);
                if (b.ring) {
                    const ru = (b.ring.material as THREE.ShaderMaterial).uniforms;
                    ru.uSun.value.copy(star.pos);
                    ru.uPlanet.value.copy(b.pos);
                    ru.uStarIntensity.value = intensity;
                    u.uRingNormal.value.copy(tmp.set(0, 1, 0).applyQuaternion(b.tiltHolder.getWorldQuaternion(new THREE.Quaternion())));
                }
            }
            // Moon labels only near their planet; planet labels hide once the planet fills the view.
            const camDist = this.camera.position.distanceTo(b.pos);
            if (b.kind === 'moon' && b.parent) {
                b.label.visible = this.camera.position.distanceTo(b.parent.pos) < b.el!.a * 40;
                if (b.orbitLine) b.orbitLine.visible = this.showOrbits && b.label.visible;
            } else {
                b.label.visible = b.radius / camDist * px < 60;
                // Up close a planet's own orbit is a line through the camera; hide it.
                if (b.orbitLine) b.orbitLine.visible = this.showOrbits && (!b.el || camDist > b.el.a * 0.02);
            }
            b.label.position.copy(b.pos);
            b.label.el.classList.toggle('target', b === this.target);
        });
        spritePos.needsUpdate = true;
        (this.sprites.material as THREE.ShaderMaterial).uniforms.uPx.value = px;
        (this.sky.material as THREE.ShaderMaterial).uniforms.uPx.value = px;
        this.sky.position.copy(this.camera.position);

        if (this.well.visible) {
            const masses = (this.well.material as THREE.ShaderMaterial).uniforms.uMasses.value as THREE.Vector4[];
            const planets = this.bodies.filter(b => b.parent === star);
            masses[0].set(star.pos.x, star.pos.y, star.pos.z, 1);
            for (let k = 1; k < 12; k++) {
                const p = planets[k - 1];
                if (p) masses[k].set(p.pos.x, p.pos.y, p.pos.z, (1000 * p.massEarth) / star.massEarth);
                else masses[k].set(0, 0, 0, 0);
            }
        }
        this.labels.update(this.camera, this.width, this.height);
    }

    private fly(dt: number) {
        const cam = this.camera;
        if (this.mode === 'orbit' && this.target) {
            cam.position.copy(this.target.pos).add(this.orbitOffset);
            const m = new THREE.Matrix4().lookAt(cam.position, this.target.pos, new THREE.Vector3(0, 1, 0));
            cam.quaternion.setFromRotationMatrix(m);
            return;
        }
        if (this.mode === 'auto' && this.target) {
            const t = this.target;
            const to = new THREE.Vector3().subVectors(t.pos, cam.position);
            const remaining = to.length() - this.parkDistance(t);
            // Trapezoidal profile: accelerate, cruise, and brake so we stop exactly at the parking orbit.
            const vBrake = Math.sqrt(2 * ACCEL * Math.max(remaining, 0));
            this.speed = Math.min(this.cruise, this.speed + ACCEL * dt, vBrake);
            const step = Math.min(this.speed * dt, Math.max(remaining, 0));
            cam.position.addScaledVector(to.normalize(), step).addScaledVector(t.vel, dt);
            const m = new THREE.Matrix4().lookAt(cam.position, t.pos, cam.up.set(0, 1, 0));
            const q = new THREE.Quaternion().setFromRotationMatrix(m);
            cam.quaternion.slerp(q, 1 - Math.exp(-4 * dt));
            if (remaining <= t.radius * 0.01) {
                const took = this.realTime - this.flightStart;
                this.lastFlight = `перелёт ${this.flightFrom} → ${t.name}: ${took.toFixed(1)} с`;
                this.host.toast(`Прибыли к ${t.name} за ${took.toFixed(1)} с`);
                this.enterOrbit(t);
            }
            return;
        }
        // Free flight. Near a surface the ship slows down, the way SpaceEngine does.
        const near = this.nearestSurface(cam.position);
        const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 10 : 1;
        const limit = Math.min(this.cruise * boost, Math.max(near.dist * 0.8, 1e-6));
        const dir = new THREE.Vector3(
            (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
            (this.keys.has('KeyR') ? 1 : 0) - (this.keys.has('KeyF') ? 1 : 0),
            (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0),
        );
        if (dir.lengthSq() > 0) dir.normalize().applyQuaternion(cam.quaternion);
        const wanted = dir.multiplyScalar(limit);
        this.velocity.lerp(wanted, 1 - Math.exp(-3 * dt));
        if (this.velocity.length() > limit) this.velocity.setLength(limit);
        this.speed = this.velocity.length();
        cam.position.addScaledVector(this.velocity, dt);
        const roll = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
        if (roll) cam.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll * dt));
        // Never inside a body.
        if (near.dist < near.body.radius * 0.02) {
            const out = new THREE.Vector3().subVectors(cam.position, near.body.pos).setLength(near.body.radius * 1.02);
            cam.position.copy(near.body.pos).add(out);
        }
    }

    click(x: number, y: number) {
        const i = pickPoint(this.bodies.length, (k, out) => out.copy(this.bodies[k].pos), k => (this.bodies[k].kind === 'moon' ? 0 : 1),
            this.camera, x, y, this.width, this.height, 22);
        if (i >= 0) this.select(this.bodies[i]);
    }

    resize(w: number, h: number) {
        this.width = w; this.height = h;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        this.host.canvas.removeEventListener('pointerdown', this.onDown);
        window.removeEventListener('pointerup', this.onUp);
        window.removeEventListener('pointermove', this.onMove);
        this.host.canvas.removeEventListener('wheel', this.onWheel);
        this.host.canvas.removeEventListener('dblclick', this.onDbl);
        this.labels.dispose();
        disposeObject(this.scene);
    }
}
