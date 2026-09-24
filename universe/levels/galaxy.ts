import * as THREE from 'three';
import {
    Action, disposeObject, Label, Labels, Level, LevelHost, particleMaterial, pickPoint, pixelScale, ProximityTrigger, row,
    spriteMaterial,
} from '../common';
import { FLY_HELP, Navigator } from '../flight';
import { gaussian, GalaxySpec, galaxyTypeName, hash32, juliaEscape, kroupaMass, mulberry32, starName } from '../mandelbrot';
import {
    blackbodyFast, fmtNum, KM_S_IN_LY_PER_MYR, mainSequence, rotationCurve, spectralClass,
} from '../physics';

const STARS = 130_000;
const DUST = 26_000;
const HII = 1100;
const SUN_R_LY = 26_000;

interface Population {
    positions: Float32Array;
    colors: Float32Array;
    sizes: Float32Array;
    masses: Float32Array;
}

function armAngle(r: number, k: number, spec: GalaxySpec): number {
    const r0 = spec.scaleLengthLy * 0.8;
    return Math.log(Math.max(r, r0) / r0) / Math.tan((spec.pitchDeg * Math.PI) / 180) + (2 * Math.PI * k) / spec.arms;
}

function generateStars(spec: GalaxySpec): Population {
    const rng = mulberry32(spec.seed);
    const positions = new Float32Array(STARS * 3);
    const colors = new Float32Array(STARS * 3);
    const sizes = new Float32Array(STARS);
    const masses = new Float32Array(STARS);
    const c = [0, 0, 0];
    const h = spec.scaleLengthLy;
    const R = spec.radiusLy;
    const barAngle = rng() * Math.PI;
    const barLen = R * 0.18;

    for (let i = 0; i < STARS; i++) {
        let x = 0, y = 0, z = 0, lo = 0.4, hi = 1.4;
        const u = rng();
        if (spec.type === 'elliptical') {
            // Plummer sphere, squashed into a triaxial ellipsoid; only old stars.
            const a = R * 0.12;
            const r = Math.min(R * 1.2, a / Math.sqrt(Math.pow(Math.max(rng(), 1e-6), -2 / 3) - 1));
            const ct = rng() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rng() * Math.PI * 2;
            x = r * st * Math.cos(ph); y = r * ct * 0.62; z = r * st * Math.sin(ph) * 0.8;
            lo = 0.3; hi = 1.0;
        } else if (spec.type === 'irregular') {
            // Clumpy star-forming regions shaped like a filled Julia set.
            for (let t = 0; t < 60; t++) {
                const jx = (rng() * 2 - 1) * 1.6, jz = (rng() * 2 - 1) * 1.6;
                const n = juliaEscape(jx, jz, spec.juliaC[0], spec.juliaC[1], 40);
                if (n >= 12 || rng() < 0.01) { x = jx * R * 0.6; z = jz * R * 0.6; break; }
            }
            y = gaussian(rng) * R * 0.05;
            lo = 0.5; hi = 30;
        } else if (u < 0.2) {
            // Bulge (and bar): old, crowded, yellow-red.
            if (spec.type === 'barred' && rng() < 0.55) {
                const bx = (rng() * 2 - 1) * barLen, bz = gaussian(rng) * barLen * 0.16;
                x = bx * Math.cos(barAngle) - bz * Math.sin(barAngle);
                z = bx * Math.sin(barAngle) + bz * Math.cos(barAngle);
                y = gaussian(rng) * 500;
            } else {
                x = gaussian(rng) * h * 0.22; y = gaussian(rng) * h * 0.14; z = gaussian(rng) * h * 0.22;
            }
            lo = 0.3; hi = 1.1;
        } else {
            // Exponential disk: surface density ∝ e^(−r/h), so r ~ Gamma(2, h).
            // Resample rather than clamp, so no ring of stars piles up at the edge.
            let r = -h * Math.log(Math.max(rng() * rng(), 1e-9));
            while (r > R * 1.15) r = -h * Math.log(Math.max(rng() * rng(), 1e-9));
            let theta: number;
            const inArm = rng() < 0.62;
            if (inArm) {
                const k = Math.floor(rng() * spec.arms);
                theta = armAngle(r, k, spec) + gaussian(rng) * (0.24 + 0.16 * r / R);
                const young = rng() < 0.5;
                lo = young ? 0.9 : 0.5; hi = young ? 40 : 2;
                y = gaussian(rng) * (young ? 160 : 350);
            } else {
                theta = rng() * Math.PI * 2;
                lo = 0.4; hi = 1.6;
                y = gaussian(rng) * 450;
            }
            if (spec.type === 'barred' && r < barLen) theta = barAngle + (rng() < 0.5 ? 0 : Math.PI) + gaussian(rng) * 0.4;
            x = r * Math.cos(theta); z = r * Math.sin(theta);
        }
        const m = kroupaMass(rng, lo, hi);
        const star = mainSequence(m);
        blackbodyFast(star.T, c);
        const b = Math.min(3, 0.25 + 0.35 * Math.pow(star.L, 0.22));
        positions.set([x, y, z], i * 3);
        colors.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        sizes[i] = 130 + 90 * Math.min(4, Math.pow(star.L, 0.15));
        masses[i] = m;
    }
    return { positions, colors, sizes, masses };
}

/** Dark dust lanes along the inner edges of the arms, and pink Hα nebulae where stars are being born. */
function generateISM(spec: GalaxySpec): { dust: THREE.BufferGeometry; hii: THREE.BufferGeometry } {
    const rng = mulberry32(spec.seed ^ 0xd057);
    const h = spec.scaleLengthLy;
    const make = (n: number, color: (i: number) => [number, number, number], size: () => number, spread: number, lag: number) => {
        const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let r = Infinity;
            while (r > spec.radiusLy) r = h * 0.4 - h * Math.log(Math.max(rng() * rng(), 1e-9)) * 0.9;
            const k = Math.floor(rng() * spec.arms);
            const theta = armAngle(r, k, spec) - lag + gaussian(rng) * spread;
            pos.set([r * Math.cos(theta), gaussian(rng) * 90, r * Math.sin(theta)], i * 3);
            col.set(color(i), i * 3);
            sz[i] = size();
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
        return g;
    };
    const dust = make(spec.type === 'elliptical' ? 0 : DUST, () => [0.02, 0.012, 0.008], () => 500 + rng() * 700, 0.09, 0.12);
    const hii = make(spec.type === 'elliptical' ? 0 : HII, () => [1.4, 0.32, 0.5], () => 180 + rng() * 380, 0.1, -0.03);
    return { dust, hii };
}

export class GalaxyLevel implements Level {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(55, 1, 10, 5e6);
    readonly title: string;
    readonly bloom = { strength: 0.9, radius: 0.55, threshold: 0.0 };
    readonly help = `${FLY_HELP} · подлетите к звезде — войдёте в её систему · клик — выбрать · двойной клик/Enter — сразу в систему`;
    private nav: Navigator;
    private flySpeed = 0;
    // Close enough to a star to drop into its system, or to the centre to meet the black hole.
    private starTrigger = new ProximityTrigger(40, 0.1);
    private coreTrigger = new ProximityTrigger(350);
    private leaveTrigger: ProximityTrigger;
    private stars: Population;
    private starMat = particleMaterial({ minPx: 1.2 });
    private dustMat = particleMaterial({ additive: false, minPx: 2, opacity: 0.5, soft: 1 });
    private hiiMat = particleMaterial({ minPx: 1.5, opacity: 0.4, soft: 1 });
    private labels: Labels;
    private sunLabel?: Label;
    private sunPos0 = new THREE.Vector3();
    private selLabel: Label;
    private marker: THREE.Points;
    private selected = -1; // star index, -2 = the Sun
    private timeMyr = 0;
    private speed = 0; // Myr per second; paused by default so stars hold still while flying among them
    private darkMatter = true;
    private width = 1;
    private height = 1;
    private onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') this.enter(); };
    private onDbl = () => this.enter();

    constructor(private host: LevelHost, private spec: GalaxySpec) {
        this.title = spec.name;
        this.stars = generateStars(spec);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.stars.positions, 3));
        g.setAttribute('aColor', new THREE.BufferAttribute(this.stars.colors, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(this.stars.sizes, 1));
        const { dust, hii } = generateISM(spec);
        for (const [geo, mat, order] of [[g, this.starMat, 0], [hii, this.hiiMat, 1], [dust, this.dustMat, 2]] as const) {
            const p = new THREE.Points(geo, mat);
            p.frustumCulled = false;
            p.renderOrder = order;
            this.scene.add(p);
        }
        for (const m of [this.starMat, this.dustMat, this.hiiMat]) {
            m.uniforms.uVFlat.value = spec.vFlat;
            m.uniforms.uKmsToLyMyr.value = KM_S_IN_LY_PER_MYR;
        }
        if (spec.type === 'elliptical') this.starMat.uniforms.uVFlat.value = 0; // pressure-supported, no ordered rotation

        // The glowing core around the central black hole.
        const core = new THREE.BufferGeometry();
        core.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        core.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([1.6, 1.25, 0.9]), 3));
        core.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([12]), 1));
        core.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array([spec.radiusLy * 0.05]), 1));
        core.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array([1]), 1));
        const corePts = new THREE.Points(core, spriteMaterial());
        corePts.frustumCulled = false;
        this.scene.add(corePts);

        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        mg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([0.4, 0.9, 1.3]), 3));
        mg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([24]), 1));
        mg.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(1), 1));
        mg.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array([1]), 1));
        this.marker = new THREE.Points(mg, spriteMaterial());
        this.marker.visible = false;
        this.marker.frustumCulled = false;
        this.scene.add(this.marker);

        this.labels = new Labels(host.labelLayer);
        const bh = this.labels.add(spec.isMilkyWay ? 'Стрелец A* — чёрная дыра' : 'Сверхмассивная чёрная дыра', 'bh',
            () => host.open({ kind: 'blackhole', galaxy: spec }));
        bh.position.set(0, 0, 0);
        if (spec.isMilkyWay) {
            const theta = armAngle(SUN_R_LY, 1, spec) + 0.06;
            this.sunPos0.set(SUN_R_LY * Math.cos(theta), 55, SUN_R_LY * Math.sin(theta));
            this.sunLabel = this.labels.add('Солнце — мы здесь', 'home', () => this.openSun());
        }
        this.selLabel = this.labels.add('', 'sel', () => this.enter());
        this.selLabel.visible = false;

        const R = spec.radiusLy;
        this.camera.position.set(R * 0.2, R * 0.9, R * 1.5);
        this.nav = new Navigator(this.camera, host.canvas, { speed: 3000, minSpeed: 0.5, maxSpeed: 5e5 }, { min: 200, max: R * 6 });
        this.nav.lookAt(new THREE.Vector3());
        // Flying out beyond 5 disk radii returns to the cosmic web (the trigger measures the margin left).
        this.leaveTrigger = new ProximityTrigger(R);
        window.addEventListener('keydown', this.onKey);
        host.canvas.addEventListener('dblclick', this.onDbl);
    }

    /** The same differential rotation as the vertex shader. */
    private rotated(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
        if (this.spec.type === 'elliptical') return out.set(x, y, z);
        const r = Math.max(Math.hypot(x, z), 1);
        const a = (-rotationCurve(r, this.spec.vFlat, this.darkMatter) * KM_S_IN_LY_PER_MYR / r) * this.timeMyr;
        const c = Math.cos(a), s = Math.sin(a);
        return out.set(c * x - s * z, y, s * x + c * z);
    }

    private openSun() {
        this.host.open({ kind: 'system', galaxy: this.spec, star: 'sun' });
    }

    private enter() {
        if (this.selected === -2) this.openSun();
        else if (this.selected >= 0) this.openStar(this.selected);
    }

    private openStar(i: number) {
        this.saveCamera();
        this.host.open({ kind: 'system', galaxy: this.spec, star: { seed: hash32(this.spec.seed, i), mass: this.stars.masses[i] } });
    }

    /** Coming back up should put us where we were, a little way back from the star we entered. */
    private saveCamera() {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(150);
        this.host.saveCamera(this.camera.position.clone().add(back), this.camera.quaternion);
    }

    resumed() {
        this.nav.fly.sync();
    }

    private sunPosition(out = new THREE.Vector3()) {
        return this.rotated(this.sunPos0.x, this.sunPos0.y, this.sunPos0.z, out);
    }

    /** Nearest star to the camera (only brighter ones count, so there is always something to aim for). */
    private nearestStar(): { i: number; d: number } {
        const p = this.stars.positions, cam = this.camera.position, v = new THREE.Vector3();
        const rc = Math.hypot(cam.x, cam.z);
        let best = -1, bestD = Infinity;
        for (let k = 0; k < STARS; k++) {
            // Cheap reject before rotating: rotation keeps the radius, so |r_star − r_cam| bounds the distance.
            const rs = Math.hypot(p[k * 3], p[k * 3 + 2]);
            if (Math.abs(rs - rc) > bestD || Math.abs(p[k * 3 + 1] - cam.y) > bestD) continue;
            this.rotated(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], v);
            const d = v.distanceTo(cam);
            if (d < bestD) { bestD = d; best = k; }
        }
        return { i: best, d: bestD };
    }

    click(x: number, y: number) {
        const p = this.stars.positions;
        const i = pickPoint(STARS, (k, out) => this.rotated(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], out),
            k => this.stars.masses[k], this.camera, x, y, this.width, this.height, 12);
        this.selected = i;
        this.marker.visible = this.selLabel.visible = i >= 0;
        if (i >= 0) {
            this.selLabel.el.textContent = `${starName(hash32(this.spec.seed, i))} ▶`;
            if (this.nav.mode === 'orbit') this.nav.orbit.target.copy(this.rotated(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], new THREE.Vector3()));
        }
    }

    actions(): Action[] {
        const list: Action[] = [];
        const p = this.stars.positions;
        if (this.selected >= 0) {
            const i = this.selected;
            list.push({ label: '➜ Подлететь', title: 'Долететь до звезды; вблизи откроется её система',
                run: () => this.nav.flyTo(() => this.rotated(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], new THREE.Vector3()), 25) });
            list.push({ label: '▶ Сразу в систему', run: () => this.enter() });
        }
        if (this.spec.isMilkyWay) {
            list.push({ label: '➜ К Солнцу', run: () => this.nav.flyTo(() => this.sunPosition(), 25) });
            list.push({ label: '☀ Солнечная система', run: () => this.openSun() });
        }
        list.push(this.nav.mode === 'free'
            ? { label: '◎ Орбита', title: 'Вращать камеру вокруг центра или выбранной звезды', run: () => {
                const t = this.selected >= 0 ? this.rotated(p[this.selected * 3], p[this.selected * 3 + 1], p[this.selected * 3 + 2], new THREE.Vector3()) : new THREE.Vector3();
                this.nav.setOrbit(t);
            } }
            : { label: '✈ Свободный полёт', title: FLY_HELP, run: () => this.nav.setFree() });
        list.push({ label: '● Чёрная дыра в центре', run: () => this.host.open({ kind: 'blackhole', galaxy: this.spec }) });
        return list;
    }

    info(): string {
        const s = this.spec;
        const vSun = rotationCurve(SUN_R_LY, s.vFlat, this.darkMatter);
        const year = (2 * Math.PI * SUN_R_LY) / (vSun * KM_S_IN_LY_PER_MYR);
        let html = row('Тип', galaxyTypeName(s.type));
        html += row('Радиус диска', `${fmtNum(s.radiusLy)} св. лет`);
        html += row('Звёзд в модели', `${fmtNum(STARS)} (каждая — скопление)`);
        html += row('Скорость вращения', `${fmtNum(s.vFlat)} км/с`);
        html += row('Галактический год на r = 26 тыс. св. лет', `${fmtNum(year)} млн лет`);
        html += row('Прошло времени', `${fmtNum(this.timeMyr)} млн лет`);
        html += `<p>${this.darkMatter
            ? 'Кривая вращения плоская: гало тёмной материи держит скорость звёзд почти постоянной до края диска.'
            : 'Без тёмной материи скорость падает как 1/√r (Кеплер): внешние звёзды отстают, рукава закручиваются.'}
            Цвета звёзд — излучение абсолютно чёрного тела при их температуре; масса взята из начальной функции масс Круппы,
            светимость L ∝ M<sup>3,5</sup>.</p>`;
        if (this.selected >= 0) {
            const m = this.stars.masses[this.selected];
            const st = mainSequence(m);
            html += `<h3>${starName(hash32(s.seed, this.selected))}</h3>`;
            html += row('Спектральный класс', spectralClass(st.T));
            html += row('Масса', `${fmtNum(m)} M☉`);
            html += row('Температура', `${fmtNum(st.T)} K`);
            html += row('Светимость', `${fmtNum(st.L)} L☉`);
            html += row('Время жизни', `${fmtNum(1e4 * m / st.L)} млн лет`);
        }
        return html;
    }

    update(dt: number) {
        this.timeMyr += dt * this.speed;
        for (const m of [this.starMat, this.dustMat, this.hiiMat]) {
            m.uniforms.uTime.value = this.timeMyr;
            m.uniforms.uDarkMatter.value = this.darkMatter ? 1 : 0;
            m.uniforms.uPx.value = pixelScale(this.camera, this.height);
        }
        this.scene.traverse(o => {
            const mat = (o as THREE.Points).material as THREE.ShaderMaterial;
            if (mat?.uniforms?.uPx && !mat.uniforms.uVFlat) mat.uniforms.uPx.value = pixelScale(this.camera, this.height);
        });
        if (this.sunLabel) this.rotated(this.sunPos0.x, this.sunPos0.y, this.sunPos0.z, this.sunLabel.position);
        if (this.selected >= 0) {
            const p = this.stars.positions, i = this.selected;
            const v = this.rotated(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], this.selLabel.position);
            (this.marker.geometry.attributes.position as THREE.BufferAttribute).copyArray([v.x, v.y, v.z]).needsUpdate = true;
        }
        this.flySpeed = this.nav.update(dt);
        this.checkTransitions(dt);
        this.labels.update(this.camera, this.width, this.height);
    }

    private checkTransitions(dt: number) {
        if (this.nav.mode !== 'free') return;
        const cam = this.camera.position;
        // Only a pilot who has slowed down near a star drops into its system; cruising through the disk does not.
        if (this.flySpeed < 150) {
            let near = { i: -1, d: Infinity };
            if (this.starTrigger.check(dt, () => {
                near = this.nearestStar();
                if (this.spec.isMilkyWay) {
                    const d = this.sunPosition().distanceTo(cam);
                    if (d < near.d) near = { i: -2, d };
                }
                return near.d;
            })) {
                this.saveCamera();
                if (near.i === -2) { this.openSun(); return; }
                this.host.toast(`Входим в систему ${starName(hash32(this.spec.seed, near.i))}`);
                this.openStar(near.i);
                return;
            }
        }
        if (this.coreTrigger.check(dt, () => cam.length())) {
            this.saveCamera();
            this.host.open({ kind: 'blackhole', galaxy: this.spec });
            return;
        }
        if (this.leaveTrigger.check(dt, () => this.spec.radiusLy * 6 - cam.length())) {
            this.host.toast('Покидаем галактику');
            this.host.back();
        }
    }

    status(): string {
        const ly = this.flySpeed;
        const mode = this.nav.mode === 'free' ? `свободный полёт, газ ${fmtNum(this.nav.fly.speed)} св. лет/с (колесо)` : 'орбита';
        return `Скорость: ${fmtNum(ly)} св. лет/с ≈ ${fmtNum(ly * 3.156e7)} c · ${mode} · до центра ${fmtNum(this.camera.position.length())} св. лет`;
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
