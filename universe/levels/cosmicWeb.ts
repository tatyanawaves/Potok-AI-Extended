import * as THREE from 'three';
import type { CameraState, LevelRequest } from '../common';
import {
    Action, disposeObject, Label, Labels, Level, LevelHost, particleMaterial, pickPoint, pixelScale, ProximityTrigger, row,
    spriteMaterial,
} from '../common';
import { FLY_HELP, Navigator } from '../flight';
import { CosmicWeb, cosmicWeb, galaxyFromWeb, GalaxySpec, galaxyTypeName, mandelbrot, mulberry32, MILKY_WAY } from '../mandelbrot';
import { blackbodyFast, fmtNum } from '../physics';

export const COUNT = 45_000;
const SCALE = 300; // Mpc: the sampled cube is ≈ 600 Mpc across, a patch of the observable universe
let cached: { web: CosmicWeb; colors: Float32Array; sizes: Float32Array; home: number } | null = null;

/** Galaxy `k` of the web, as the map would open it (the Milky Way at its home spot). */
export function webGalaxy(k: number): GalaxySpec {
    const { web, home } = build();
    const i = ((k % web.count) + web.count) % web.count;
    if (i === home) return MILKY_WAY;
    const p = web.positions;
    return galaxyFromWeb(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], web.traps[i]);
}

function build() {
    if (cached) return cached;
    const web = cosmicWeb(COUNT, 20_260_923);
    const rng = mulberry32(7);
    const colors = new Float32Array(web.count * 3);
    const sizes = new Float32Array(web.count);
    const c = [0, 0, 0];
    let home = 0, homeScore = Infinity;
    for (let i = 0; i < web.count; i++) {
        const x = web.positions[i * 3], z = web.positions[i * 3 + 2];
        const m = mandelbrot(x * 1.1 - 0.55, z * 1.1, 48);
        // Old ellipticals are red, spirals white, star-forming irregulars blue.
        const T = !m.escaped ? 3800 + rng() * 800 : m.smooth > 12 ? 5500 + rng() * 2500 : m.smooth > 5 ? 6500 + rng() * 4000 : 10_000 + rng() * 8000;
        blackbodyFast(T, c);
        const b = 0.35 + 0.9 * Math.pow(rng(), 2);
        colors.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        sizes[i] = 0.8 + 2.2 * Math.pow(rng(), 3);
        // Our home: a spiral on a filament, away from the dense nodes.
        const score = Math.abs(web.traps[i] - 0.55) + Math.abs(Math.hypot(x, web.positions[i * 3 + 1], z) - 0.45);
        if (m.escaped && m.smooth > 12 && score < homeScore) { homeScore = score; home = i; }
    }
    cached = { web, colors, sizes, home };
    return cached;
}

export class CosmicWebLevel implements Level {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1e5);
    readonly title = 'Космическая паутина';
    readonly bloom = { strength: 1.1, radius: 0.6, threshold: 0.0 };
    readonly help = `${FLY_HELP} · сбросьте скорость у галактики — войдёте в неё · клик — выбрать · двойной клик/Enter — войти`;
    private nav: Navigator;
    private flySpeed = 0;
    private pos: Float32Array;
    private galaxyTrigger = new ProximityTrigger(1.5, 0.1);
    private material = particleMaterial({ minPx: 1.4 });
    private data = build();
    private labels: Labels;
    private homeLabel: Label;
    private selLabel: Label;
    private marker: THREE.Points;
    private selected = -1;
    /** The galaxy the pilot is in («вы здесь»). */
    private here = -1;
    private width = 1;
    private height = 1;
    private onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') this.enter(); };
    private onDbl = () => this.enter();

    constructor(private host: LevelHost, from?: LevelRequest) {
        const { web, colors, sizes, home } = this.data;
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(web.positions.length);
        for (let i = 0; i < pos.length; i++) pos[i] = web.positions[i] * SCALE;
        this.pos = pos;
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        const pts = new THREE.Points(g, this.material);
        pts.frustumCulled = false;
        this.scene.add(pts);

        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        mg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([0.4, 0.9, 1.2]), 3));
        mg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([26]), 1));
        mg.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(1), 1));
        mg.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array([1]), 1));
        this.marker = new THREE.Points(mg, spriteMaterial());
        this.marker.visible = false;
        this.scene.add(this.marker);

        this.labels = new Labels(host.labelLayer);
        // Where the pilot is: the galaxy they came up from (the Milky Way unless a portal took them away).
        const here = from?.kind === 'galaxy' ? (from.galaxy.isMilkyWay ? home : from.galaxy.webIndex ?? -1) : home;
        this.here = here;
        this.homeLabel = this.labels.add(here === home ? '📍 Вы здесь' : 'Млечный Путь', here === home ? 'home' : 'star',
            () => this.openGalaxy(home));
        if (here === home) this.homeLabel.el.title = 'Млечный Путь — вернуться туда, где корабль';
        this.homeLabel.position.fromArray(pos, home * 3);
        if (here >= 0 && here !== home && from?.kind === 'galaxy') {
            const l = this.labels.add('📍 Вы здесь', 'home', () => this.openGalaxy(here));
            l.el.title = `${from.galaxy.name} — вернуться туда, где корабль`;
            l.position.fromArray(pos, here * 3);
        }
        this.selLabel = this.labels.add('', 'sel', () => this.enter());
        this.selLabel.visible = false;

        this.camera.position.set(0, 180, 620);
        this.nav = new Navigator(this.camera, host.canvas, { speed: 20, minSpeed: 0.02, maxSpeed: 3000 }, { min: 5, max: 2000 });
        this.nav.orbit.autoRotateSpeed = 0.25;
        this.nav.lookAt(new THREE.Vector3());
        if (here >= 0) {
            const at = new THREE.Vector3().fromArray(pos, here * 3);
            this.camera.position.copy(at).add(new THREE.Vector3(0, 160, 480)); // back from the filament, the marked galaxy in view
            this.nav.lookAt(at);
        }
        window.addEventListener('keydown', this.onKey);
        host.canvas.addEventListener('dblclick', this.onDbl);
    }

    private spec(i: number): GalaxySpec {
        if (i === this.data.home) return MILKY_WAY;
        const p = this.data.web.positions;
        return galaxyFromWeb(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], this.data.web.traps[i]);
    }

    private enter() {
        if (this.selected >= 0) this.openGalaxy(this.selected);
    }

    private galaxyPos(i: number, out = new THREE.Vector3()) {
        return out.fromArray(this.pos, i * 3);
    }

    private openGalaxy(i: number) {
        if (i === this.here && this.host.returnDown()) return; // back to the ship, not a fresh galaxy
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(6);
        this.host.saveCamera(this.camera.position.clone().add(back), this.camera.quaternion);
        this.host.open({ kind: 'galaxy', galaxy: this.spec(i) });
    }

    saveState(): CameraState {
        return { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() };
    }

    resumed() {
        this.nav.fly.sync();
    }

    private nearestGalaxy(): { i: number; d: number } {
        const p = this.pos, c = this.camera.position;
        let best = -1, bestD2 = Infinity;
        for (let k = 0; k < this.data.web.count; k++) {
            const dx = p[k * 3] - c.x, dy = p[k * 3 + 1] - c.y, dz = p[k * 3 + 2] - c.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = k; }
        }
        return { i: best, d: Math.sqrt(bestD2) };
    }

    click(x: number, y: number) {
        const p = this.data.web.positions;
        const i = pickPoint(this.data.web.count, (k, out) => out.set(p[k * 3] * SCALE, p[k * 3 + 1] * SCALE, p[k * 3 + 2] * SCALE),
            k => this.data.sizes[k], this.camera, x, y, this.width, this.height);
        this.selected = i;
        this.marker.visible = i >= 0;
        this.selLabel.visible = i >= 0;
        if (i < 0) return;
        const pos = new THREE.Vector3(p[i * 3] * SCALE, p[i * 3 + 1] * SCALE, p[i * 3 + 2] * SCALE);
        (this.marker.geometry.attributes.position as THREE.BufferAttribute).copyArray([pos.x, pos.y, pos.z]).needsUpdate = true;
        this.selLabel.position.copy(pos);
        this.selLabel.el.textContent = `${this.spec(i).name} ▶`;
        if (this.nav.mode === 'orbit') this.nav.orbit.target.copy(pos);
    }

    actions(): Action[] {
        const home = this.data.home;
        const list: Action[] = [
            { label: '➜ К Млечному Пути', run: () => this.nav.flyTo(() => this.galaxyPos(home), 1) },
            { label: '🏠 Сразу в Млечный Путь', run: () => this.host.open({ kind: 'galaxy', galaxy: MILKY_WAY }) },
            this.nav.mode === 'free'
                ? { label: '⟳ Облёт', title: 'Камера вращается вокруг центра или выбранной галактики',
                    run: () => this.nav.setOrbit(this.selected >= 0 ? this.galaxyPos(this.selected) : new THREE.Vector3(), true) }
                : { label: '✈ Свободный полёт', title: FLY_HELP, run: () => this.nav.setFree() },
        ];
        if (this.selected >= 0) {
            const i = this.selected;
            list.unshift({ label: '▶ Войти', run: () => this.enter() });
            list.unshift({ label: '➜ Подлететь', title: 'Долететь до галактики; вблизи откроется она сама', run: () => this.nav.flyTo(() => this.galaxyPos(i), 1) });
        }
        return list;
    }

    info(): string {
        let html = `<p>${fmtNum(this.data.web.count)} галактик лежат на поверхности <b>Мандельбульба</b> — трёхмерного
        множества Мандельброта степени 8 (z → z⁸ + c в сферических координатах), приближенной к одному из её участков.
        Внутренность множества стала пустотами-войдами, складки границы — стенами и филаментами, как у наблюдаемой
        крупномасштабной структуры: её корреляционная размерность тоже близка к 2.</p>`;
        html += row('Размер куба', `≈ ${fmtNum(2 * SCALE)} Мпк`);
        html += row('Тип галактики', 'по времени ухода в 2D-множестве');
        if (this.selected >= 0) {
            const s = this.spec(this.selected);
            html += `<h3>${s.name}</h3>`;
            html += row('Тип', galaxyTypeName(s.type));
            html += row('Радиус диска', `${fmtNum(s.radiusLy)} св. лет`);
            html += row('Скорость вращения', `${fmtNum(s.vFlat)} км/с`);
            html += row('Центральная чёрная дыра', `${fmtNum(s.bhMassSun)} M☉`);
        }
        return html;
    }

    status(): string {
        const mode = this.nav.mode === 'free' ? `свободный полёт, газ ${fmtNum(this.nav.fly.speed)} Мпк/с (колесо)` : 'облёт';
        return `Скорость: ${fmtNum(this.flySpeed)} Мпк/с · ${mode}`;
    }

    update(dt: number) {
        this.flySpeed = this.nav.update(dt);
        if (this.nav.mode === 'free' && this.flySpeed < 10) {
            let near = { i: -1, d: Infinity };
            if (this.galaxyTrigger.check(dt, () => (near = this.nearestGalaxy()).d)) {
                this.host.toast(`Входим в галактику ${this.spec(near.i).name}`);
                this.openGalaxy(near.i);
            }
        }
        this.material.uniforms.uPx.value = pixelScale(this.camera, this.height);
        (this.marker.material as THREE.ShaderMaterial).uniforms.uPx.value = pixelScale(this.camera, this.height);
        this.labels.update(this.camera, this.width, this.height);
    }

    resize(w: number, h: number) {
        this.width = w; this.height = h;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        this.nav.dispose();
        this.labels.dispose();
        window.removeEventListener('keydown', this.onKey);
        this.host.canvas.removeEventListener('dblclick', this.onDbl);
        disposeObject(this.scene);
    }
}
