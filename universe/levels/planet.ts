import * as THREE from 'three';
import { Action, Level, LevelHost, row } from '../common';
import { AtmosphereParams, scatter, SurfaceParams, sunTransmittance, surfaceFor } from '../atmosphere';
import { FLY_HELP, FlyController } from '../flight';
import { ShipGame } from '../game/shipGame';
import { Mission } from '../game/missions';
import type { PlanetKind } from '../mandelbrot';
import { fmtNum } from '../physics';
import { SKY_FRAG, SKY_VERT, TERRAIN_FRAG, TERRAIN_VERT, WATER_FRAG, WATER_VERT } from '../planetShaders';
import { terrainHeight, TerrainParams } from '../terrain';

export interface PlanetVisit {
    name: string;
    kind: PlanetKind | 'moon';
    radiusKm: number;
    gravity: number;
    dayDays: number;
    seed: number;
    /** Identifies the system, so missions are kept per place. */
    systemKey: string;
}

const PALETTE: Record<SurfaceParams['palette'], number> = { earth: 0, mars: 1, moon: 2, ice: 3, lava: 4, venus: 5, desert: 1, titan: 6 };
const GRID = 384;
const REACH = 90_000; // m, terrain radius around the camera

/** Surface missions: something is always stirring below. */
function surfaceMissions(name: string, hasAir: boolean): Mission[] {
    const m = (id: string, title: string, brief: string, spawn: Mission['spawn'], kind: Mission['objectives'][number], reward: number): Mission => ({
        id, title, brief, location: name, triggerKm: 1e9, spawn, objectives: [kind], reward, state: 'available', spawned: false, startedAt: 0,
    });
    const list = [
        m('s-colony', 'Оборона колонии', `Кристаллиды атакуют поселение на поверхности (${name}).`,
            [{ kind: 'crystal', count: 8 }], { type: 'kill', enemy: 'crystal', count: 8, done: 0 }, 500),
        m('s-drones', 'Сбить разведчиков', 'Чужие дроны картографируют местность.',
            [{ kind: 'drone', count: 5 }], { type: 'kill', enemy: 'drone', count: 5, done: 0 }, 400),
    ];
    if (hasAir) {
        list.push(m('s-leviathan', 'Небесный левиафан', 'В облаках кружит исполинское существо.',
            [{ kind: 'leviathan', count: 1 }], { type: 'kill', enemy: 'leviathan', count: 1, done: 0 }, 2000));
    }
    return list;
}

/** Surface pressure, bar, for the bodies we know. */
const PRESSURE: Record<string, number> = { 'Земля': 1.013, 'Марс': 0.006, 'Венера': 92, 'Титан': 1.45 };

export class PlanetLevel implements Level {
    readonly scene = new THREE.Scene();
    // The sky dome must sit well inside the far plane, or its triangles get clipped away.
    readonly camera = new THREE.PerspectiveCamera(65, 1, 0.3, 2e7);
    readonly title: string;
    readonly bloom = { strength: 0.35, radius: 0.4, threshold: 1.2 };
    readonly help = `${FLY_HELP} · Пробел — огонь · V — вид · M — миссии · наберите высоту, чтобы выйти в космос`;
    private surface: SurfaceParams;
    private terrain: TerrainParams;
    private pilot = new THREE.PerspectiveCamera(65, 1, 0.3, 2e7);
    private ctl: FlyController;
    private game: ShipGame;
    private sky: THREE.Mesh;
    private ground: THREE.Mesh;
    private water: THREE.Mesh | null = null;
    private uniforms: Record<string, THREE.IUniform>;
    private hourAngle = -1.15; // morning
    private latitude = 0.7;
    private daySpeed = 120;
    private time = 0;
    private speed = 0;
    private width = 1;
    private height = 1;
    private exitAltitude: number;
    private leaving = false;
    private sunColor = new THREE.Vector3();

    constructor(private host: LevelHost, private visit: PlanetVisit) {
        this.title = `${visit.name}: поверхность`;
        this.surface = surfaceFor(visit.name, visit.kind, visit.radiusKm, visit.gravity);
        const s = this.surface;
        this.terrain = {
            relief: s.relief, craters: s.craters, seed: (visit.seed % 997) * 0.37 + 11.3,
            seaBias: s.sea === null ? 0 : 0.08,
        };
        const a: AtmosphereParams | null = s.atmosphere;
        this.exitAltitude = a ? (a.top - 1) * s.radiusM * 1.1 : 60_000;

        // Uniforms shared by sky, ground and water.
        this.uniforms = {
            uHasAtmo: { value: a ? 1 : 0 },
            uTop: { value: a?.top ?? 1.01 },
            uBetaR: { value: new THREE.Vector3(...(a?.betaR ?? [0, 0, 0])) },
            uBetaM: { value: new THREE.Vector3(...(a?.betaM ?? [0, 0, 0])) },
            uHR: { value: a?.hR ?? 0.001 },
            uHM: { value: a?.hM ?? 0.001 },
            uG: { value: a?.g ?? 0.76 },
            uForwardTint: { value: new THREE.Vector3(...(a?.forwardTint ?? [1, 1, 1])) },
            uMulti: { value: a?.multi ?? 0 },
            uAbsorbM: { value: new THREE.Vector3(...(a?.absorbM ?? [0, 0, 0])) },
            uSunIntensity: { value: a?.sunIntensity ?? 20 },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uPlanetR: { value: s.radiusM },
            uPlanetRV: { value: s.radiusM },
            uCamAlt: { value: 100 },
            uSunColor: { value: new THREE.Vector3(1, 1, 1) },
            uAmbient: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
            uZenith: { value: new THREE.Vector3() },
            uHorizon: { value: new THREE.Vector3() },
            uRelief: { value: this.terrain.relief },
            uSeed: { value: this.terrain.seed },
            uSeaBias: { value: this.terrain.seaBias },
            uCraters: { value: this.terrain.craters ? 1 : 0 },
            uPalette: { value: PALETTE[s.palette] },
            uSea: { value: s.sea ?? -1e5 },
            uOffset: { value: new THREE.Vector2() },
            uTime: { value: 0 },
            uDeep: { value: new THREE.Vector3(...(s.palette === 'titan' ? [0.02, 0.012, 0.005] : [0.0, 0.025, 0.05])) },
        };

        this.sky = new THREE.Mesh(new THREE.SphereGeometry(1e6, 64, 32), new THREE.ShaderMaterial({
            vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false,
        }));
        this.sky.renderOrder = -1;
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);

        this.ground = new THREE.Mesh(this.grid(), new THREE.ShaderMaterial({
            vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.uniforms,
        }));
        this.ground.frustumCulled = false;
        this.scene.add(this.ground);

        if (s.sea !== null) {
            this.water = new THREE.Mesh(this.grid(160), new THREE.ShaderMaterial({
                vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: this.uniforms,
            }));
            this.water.frustumCulled = false;
            this.scene.add(this.water);
        }

        // Arrive high over a valley, looking at the horizon.
        const start = this.findLandingSpot();
        this.pilot.position.set(start.x, Math.max(this.groundAt(start.x, start.y), s.sea ?? -1e9) + 1500, start.y);
        this.pilot.rotation.set(-0.12, 0.6, 0, 'YXZ');
        this.ctl = new FlyController(this.pilot, host.canvas, { speed: 300, minSpeed: 5, maxSpeed: 30_000 });

        const anchor = { name: visit.name, pos: new THREE.Vector3(), radius: 0 };
        this.game = new ShipGame(this.scene, host.canvas, host.labelLayer, `${visit.systemKey}:${visit.name}`,
            () => surfaceMissions(visit.name, !!a), n => (n === visit.name ? anchor : undefined), t => host.toast(t),
            { unitsPerKm: 1000, ground: (x, z) => Math.max(this.groundAt(x * 1000, z * 1000), s.sea ?? -1e9) / 1000 });
        this.game.combat.anchor = anchor;
        host.toast(`${visit.name}: ${a ? 'вход в атмосферу' : 'посадка на безвоздушную поверхность'}. g = ${fmtNum(visit.gravity)} м/с²`);
    }

    /** A grid denser near the centre: ~50 m spacing underfoot, ~600 m at the horizon. */
    private grid(n = GRID): THREE.BufferGeometry {
        const g = new THREE.PlaneGeometry(2, 2, n, n);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position as THREE.BufferAttribute;
        const warp = (u: number) => REACH * (0.12 * u + 0.88 * u * Math.abs(u));
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, warp(pos.getX(i)), 0, warp(pos.getZ(i)));
        return g;
    }

    private groundAt(x: number, z: number) {
        return terrainHeight(this.terrain, x, z);
    }

    private findLandingSpot(): THREE.Vector2 {
        // Prefer land a little above sea level, where there is something to see.
        const sea = this.surface.sea ?? -1e9;
        for (let k = 0; k < 200; k++) {
            const x = (k % 20) * 7000 - 60_000, z = Math.floor(k / 20) * 7000 - 30_000;
            const h = this.groundAt(x, z);
            if (h > sea + 100 && h < this.surface.relief * 0.6) return new THREE.Vector2(x, z);
        }
        return new THREE.Vector2();
    }

    private sunDirection(): THREE.Vector3 {
        const H = this.hourAngle, lat = this.latitude;
        return new THREE.Vector3(Math.sin(H), Math.cos(H) * Math.cos(lat), Math.cos(H) * Math.sin(lat)).normalize();
    }

    actions(): Action[] {
        const set = (h: number) => () => { this.hourAngle = h; };
        return [
            ...this.game.actions(),
            { label: '🌅 Утро', run: set(-1.35) },
            { label: '☀ Полдень', run: set(0) },
            { label: '🌇 Закат', run: set(1.45) },
            { label: '🌙 Ночь', run: set(Math.PI) },
            ...([[0, '⏸'], [120, 'сутки ×120'], [1200, '×1200']] as [number, string][]).map(([v, l]) => ({
                label: l, title: 'Скорость смены дня и ночи', run: () => { this.daySpeed = v; }, active: () => this.daySpeed === v,
            })),
            { label: '⬆ В космос', run: () => this.leave() },
        ];
    }

    private leave() {
        if (this.leaving) return;
        this.leaving = true;
        this.host.back();
    }

    info(): string {
        const s = this.surface, v = this.visit;
        let html = row('Радиус', `${fmtNum(v.radiusKm)} км`);
        html += row('Ускорение свободного падения', `${fmtNum(v.gravity)} м/с²`);
        if (PRESSURE[v.name] !== undefined) html += row('Давление у поверхности', `${fmtNum(PRESSURE[v.name])} бар`);
        html += row('Высота над датумом', `${fmtNum(this.pilot.position.y)} м`);
        html += row('Горизонт', `${fmtNum(Math.sqrt(2 * s.radiusM * Math.max(this.pilot.position.y, 1)) / 1000)} км`);
        const elev = (Math.asin(this.sunDirection().y) * 180) / Math.PI;
        html += row('Высота Солнца', `${elev.toFixed(1)}°`);
        html += s.atmosphere
            ? `<p>Небо считается в реальном времени: рэлеевское рассеяние на молекулах (∝ λ⁻⁴ — поэтому небо Земли голубое)
               и рассеяние Ми на аэрозолях и пыли, с поглощением по пути к Солнцу — отсюда красные закаты.
               Дальние горы тонут в «воздушной перспективе». ${v.name === 'Марс' ? 'На Марсе пыль делает дневное небо рыжим, а вокруг заходящего Солнца — голубым.' : ''}</p>`
            : `<p>Атмосферы нет: небо чёрное даже днём, звёзды видны при Солнце, тени резкие, горизонт не размывается.</p>`;
        html += `<p>Рельеф — фрактальный шум (fBm и «хребтовый» шум${s.craters ? ', плюс ударные кратеры с валами' : ''}), одна и та же функция на GPU и в коде столкновений.
            Поверхность изгибается вместе с планетой: на расстоянии d она опускается на d²/2R.</p>`;
        return html;
    }

    status(): string {
        const alt = this.pilot.position.y - Math.max(this.groundAt(this.pilot.position.x, this.pilot.position.z), this.surface.sea ?? -1e9);
        const hours = ((this.hourAngle / (2 * Math.PI)) * 24 + 12 + 24) % 24;
        const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
        return `Скорость: ${fmtNum(this.speed)} м/с · над землёй ${fmtNum(alt)} м · местное время ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · газ ${fmtNum(this.ctl.speed)} м/с (колесо)`;
    }

    update(dt: number) {
        this.time += dt;
        const secondsPerDay = Math.abs(this.visit.dayDays) * 86_400;
        this.hourAngle += ((2 * Math.PI) / secondsPerDay) * dt * this.daySpeed * Math.sign(this.visit.dayDays || 1);
        if (this.hourAngle > Math.PI) this.hourAngle -= 2 * Math.PI;
        if (this.hourAngle < -Math.PI) this.hourAngle += 2 * Math.PI;

        // Flight: fast when high, careful near the ground, never through it.
        const p = this.pilot.position;
        const floor = Math.max(this.groundAt(p.x, p.z), this.surface.sea ?? -1e9);
        const alt = p.y - floor;
        const limit = Math.min(Math.max(40, alt * 2.5), this.game.speedLimit(p, this.ctl.boosted));
        this.speed = this.ctl.update(dt, limit);
        const newFloor = Math.max(this.groundAt(p.x, p.z), this.surface.sea ?? -1e9) + 12;
        if (p.y < newFloor) p.y = newFloor;
        if (this.game.wantsFree) this.game.wantsFree = false;

        // Light: sunlight through the air to here, and the sky's own glow as ambient light.
        const sun = this.sunDirection();
        const a = this.surface.atmosphere;
        const u = this.uniforms;
        u.uSunDir.value.copy(sun);
        u.uCamAlt.value = Math.max(this.camera.position.y, 0);
        const R = this.surface.radiusM;
        if (a) {
            const t = sunTransmittance(a, Math.max(p.y, 0) / R, [sun.x, sun.y, sun.z]);
            this.sunColor.set(t[0], t[1], t[2]).multiplyScalar(a.sunIntensity * 0.08);
            const obs: [number, number, number] = [0, 1 + Math.max(p.y, 0) / R, 0];
            const zen = scatter(a, obs, [0, 1, 0], [sun.x, sun.y, sun.z], 12, 6);
            const away = new THREE.Vector3(-sun.x, 0.08, -sun.z).normalize();
            const hor = scatter(a, obs, [away.x, away.y, away.z], [sun.x, sun.y, sun.z], 12, 6);
            u.uZenith.value.set(...zen);
            u.uHorizon.value.set(...hor);
            u.uAmbient.value.set(zen[0], zen[1], zen[2]).multiplyScalar(0.9);
        } else {
            const up = sun.y > -0.01 ? 1 : 0;
            this.sunColor.set(2.6, 2.55, 2.45).multiplyScalar(up);
            u.uZenith.value.set(0, 0, 0);
            u.uHorizon.value.set(0.01, 0.01, 0.012);
            u.uAmbient.value.set(0.01, 0.01, 0.012);
        }
        u.uSunColor.value.copy(this.sunColor);
        u.uTime.value = this.time;
        // Keep the terrain grid under the camera, snapped to its finest spacing so it does not swim.
        const step = (REACH * 0.24) / GRID;
        u.uOffset.value.set(Math.round(this.camera.position.x / step) * step, Math.round(this.camera.position.z / step) * step);

        this.game.update(dt, {
            pilot: this.pilot, camera: this.camera, free: true, velocity: this.ctl.velocity,
            starPos: this.pilot.position.clone().addScaledVector(sun, 1e5), nearest: { name: this.visit.name, pos: new THREE.Vector3(), radius: 0 },
            width: this.width, height: this.height, now: this.time,
        });
        this.sky.position.copy(this.camera.position);

        if (p.y > this.exitAltitude) {
            this.host.toast(`Выход на орбиту: ${this.visit.name}`);
            this.leave();
        }
    }

    resize(w: number, h: number) {
        this.width = w; this.height = h;
        for (const c of [this.camera, this.pilot]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    }

    dispose() {
        this.ctl.dispose();
        this.game.dispose();
        this.scene.traverse(o => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
            const mat = m.material as THREE.Material | undefined;
            mat?.dispose?.();
        });
    }
}
