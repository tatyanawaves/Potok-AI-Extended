import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    Action, disposeObject, Label, Labels, Level, LevelHost, particleMaterial, pickPoint, pixelScale, row, spriteMaterial,
} from '../common';
import { CosmicWeb, cosmicWeb, galaxyFromWeb, GalaxySpec, galaxyTypeName, mandelbrot, mulberry32, MILKY_WAY } from '../mandelbrot';
import { blackbodyFast, fmtNum } from '../physics';

const COUNT = 45_000;
const SCALE = 300; // Mpc: the sampled cube is ≈ 600 Mpc across, a patch of the observable universe
let cached: { web: CosmicWeb; colors: Float32Array; sizes: Float32Array; home: number } | null = null;

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
    readonly help = 'Мышь — вращать · колесо — приблизить · клик по галактике — выбрать · двойной клик или Enter — войти';
    private controls: OrbitControls;
    private material = particleMaterial({ minPx: 1.4 });
    private data = build();
    private labels: Labels;
    private homeLabel: Label;
    private selLabel: Label;
    private marker: THREE.Points;
    private selected = -1;
    private width = 1;
    private height = 1;
    private onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') this.enter(); };
    private onDbl = () => this.enter();

    constructor(private host: LevelHost) {
        const { web, colors, sizes, home } = this.data;
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(web.positions.length);
        for (let i = 0; i < pos.length; i++) pos[i] = web.positions[i] * SCALE;
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
        this.homeLabel = this.labels.add('Млечный Путь — мы здесь', 'home', () => this.host.open({ kind: 'galaxy', galaxy: MILKY_WAY }));
        this.homeLabel.position.fromArray(pos, home * 3);
        this.selLabel = this.labels.add('', 'sel', () => this.enter());
        this.selLabel.visible = false;

        this.camera.position.set(0, 180, 620);
        this.controls = new OrbitControls(this.camera, host.canvas);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.25;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 2000;
        window.addEventListener('keydown', this.onKey);
        host.canvas.addEventListener('dblclick', this.onDbl);
    }

    private spec(i: number): GalaxySpec {
        if (i === this.data.home) return MILKY_WAY;
        const p = this.data.web.positions;
        return galaxyFromWeb(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], this.data.web.traps[i]);
    }

    private enter() {
        if (this.selected >= 0) this.host.open({ kind: 'galaxy', galaxy: this.spec(this.selected) });
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
        this.controls.autoRotate = false;
    }

    actions(): Action[] {
        const list: Action[] = [
            { label: '🏠 Млечный Путь', run: () => this.host.open({ kind: 'galaxy', galaxy: MILKY_WAY }) },
            {
                label: '⟳ Вращение', run: () => { this.controls.autoRotate = !this.controls.autoRotate; },
                active: () => this.controls.autoRotate,
            },
        ];
        if (this.selected >= 0) list.unshift({ label: '▶ Войти в галактику', run: () => this.enter() });
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

    update(dt: number) {
        this.controls.update(dt);
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
        this.controls.dispose();
        this.labels.dispose();
        window.removeEventListener('keydown', this.onKey);
        this.host.canvas.removeEventListener('dblclick', this.onDbl);
        disposeObject(this.scene);
    }
}
