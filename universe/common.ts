import * as THREE from 'three';
import { blackbodyFast, blackbodyLUT, BLACKBODY_LUT_RANGE } from './physics';
import { mulberry32 } from './mandelbrot';
import { PARTICLE_FRAG, PARTICLE_VERT, SPRITE_FRAG, SPRITE_VERT } from './shaders';

/** What a level needs from the app shell. */
export interface LevelHost {
    renderer: THREE.WebGLRenderer;
    canvas: HTMLCanvasElement;
    labelLayer: HTMLElement;
    /** Replace the current level by a child one (pushes onto the breadcrumb path). */
    open(request: LevelRequest): void;
    /** Jump to a whole new place in the universe (a portal): replaces the breadcrumb path. */
    warp(path: LevelRequest[]): void;
    /** Go up one level, as if the pilot flew out of this one. */
    back(): void;
    /** Remember where the camera is, so coming back up returns here instead of to the overview. */
    saveCamera(position: THREE.Vector3, quaternion: THREE.Quaternion, data?: CameraState['data']): void;
    toast(text: string): void;
}

export interface CameraState {
    position: number[];
    quaternion: number[];
    /** Anything else a level needs to pick up where it left off (time, the planet we landed on…). */
    data?: Record<string, number | string>;
}

export type LevelRequest = (
    | { kind: 'web' }
    | { kind: 'galaxy'; galaxy: import('./mandelbrot').GalaxySpec }
    | { kind: 'system'; galaxy: import('./mandelbrot').GalaxySpec; star: { seed: number; mass: number; index?: number } | 'sun' }
    | { kind: 'blackhole'; galaxy: import('./mandelbrot').GalaxySpec }
    | { kind: 'planet'; galaxy: import('./mandelbrot').GalaxySpec; visit: import('./levels/planet').PlanetVisit }
) & {
    resume?: CameraState;
    /** The place one level down that the pilot came up from: a map marks it «вы здесь». */
    from?: LevelRequest;
};

export interface Action {
    label: string;
    title?: string;
    run: () => void;
    active?: () => boolean;
}

export interface Level {
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    readonly title: string;
    readonly bloom: { strength: number; radius: number; threshold: number };
    /** Pixel ratio cap; the ray-traced black hole is expensive. */
    readonly maxPixelRatio?: number;
    readonly help: string;
    actions(): Action[];
    /** Places to go, rendered as a list once when the level opens. */
    targets?(): Action[];
    info(): string;
    /** One line for the flight status bar. */
    status?(): string;
    update(dt: number): void;
    resize(width: number, height: number): void;
    /** Size of the drawing buffer in device pixels, for full-screen shaders. */
    setBufferSize?(width: number, height: number): void;
    click?(x: number, y: number): void;
    /** The camera was put back where the pilot left it; controllers should take it over. */
    resumed?(state: CameraState): void;
    /** Where the pilot is, for the saved game (null: start this place afresh). */
    saveState?(): CameraState | null;
    dispose(): void;
}

// ---------------------------------------------------------------------------
// Screen-space labels
// ---------------------------------------------------------------------------

export interface Label {
    el: HTMLDivElement;
    position: THREE.Vector3;
    visible: boolean;
}

export class Labels {
    private items: Label[] = [];
    private v = new THREE.Vector3();

    constructor(private layer: HTMLElement) {}

    add(text: string, className = '', onClick?: () => void): Label {
        const el = document.createElement('div');
        el.className = `ulabel ${className}`;
        el.textContent = text;
        if (onClick) {
            el.classList.add('clickable');
            el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        }
        this.layer.appendChild(el);
        const label = { el, position: new THREE.Vector3(), visible: true };
        this.items.push(label);
        return label;
    }

    update(camera: THREE.Camera, width: number, height: number) {
        for (const l of this.items) {
            // Touch the DOM only when something changed: style writes every frame add up.
            const shown = l.el.style.display !== 'none';
            if (!l.visible) { if (shown) l.el.style.display = 'none'; continue; }
            this.v.copy(l.position).project(camera);
            const onScreen = this.v.z < 1 && this.v.z > -1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
            if (!onScreen) { if (shown) l.el.style.display = 'none'; continue; }
            if (!shown) l.el.style.display = '';
            const x = (this.v.x * 0.5 + 0.5) * width;
            const y = (-this.v.y * 0.5 + 0.5) * height;
            const t = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
            if (l.el.style.transform !== t) l.el.style.transform = t;
        }
    }

    dispose() {
        for (const l of this.items) l.el.remove();
        this.items = [];
    }
}

// ---------------------------------------------------------------------------
// Picking points by their projection on screen
// ---------------------------------------------------------------------------

const tmp = new THREE.Vector3();

/** Index of the point nearest to (x, y) on screen within maxPx, preferring the brighter ones. */
export function pickPoint(
    count: number, positionOf: (i: number, out: THREE.Vector3) => THREE.Vector3, weightOf: (i: number) => number,
    camera: THREE.Camera, x: number, y: number, width: number, height: number, maxPx = 14,
): number {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < count; i++) {
        positionOf(i, tmp).project(camera);
        if (tmp.z > 1 || tmp.z < -1) continue;
        const sx = (tmp.x * 0.5 + 0.5) * width, sy = (-tmp.y * 0.5 + 0.5) * height;
        const d = Math.hypot(sx - x, sy - y);
        if (d > maxPx) continue;
        const score = d / (0.5 + weightOf(i));
        if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function pixelScale(camera: THREE.PerspectiveCamera, height: number): number {
    return height / 2 / Math.tan((camera.fov * Math.PI) / 360);
}

export function particleMaterial(opts: { additive?: boolean; minPx?: number; opacity?: number; soft?: number } = {}) {
    return new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: {
            uTime: { value: 0 },
            uVFlat: { value: 0 },
            uDarkMatter: { value: 1 },
            uPx: { value: 800 },
            uKmsToLyMyr: { value: 0 },
            uMinPx: { value: opts.minPx ?? 1.5 },
            uOpacity: { value: opts.opacity ?? 1 },
            uSoft: { value: opts.soft ?? 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
}

export function spriteMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: SPRITE_FRAG,
        uniforms: { uPx: { value: 800 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
}

let lutTexture: THREE.DataTexture | null = null;
export function blackbodyTexture(): THREE.DataTexture {
    if (lutTexture) return lutTexture;
    const src = blackbodyLUT();
    const data = new Float32Array(BLACKBODY_LUT_RANGE.size * 4);
    for (let k = 0; k < BLACKBODY_LUT_RANGE.size; k++) {
        data.set([src[k * 3], src[k * 3 + 1], src[k * 3 + 2], 1], k * 4);
    }
    lutTexture = new THREE.DataTexture(data, BLACKBODY_LUT_RANGE.size, 1, THREE.RGBAFormat, THREE.FloatType);
    lutTexture.magFilter = THREE.LinearFilter;
    lutTexture.minFilter = THREE.LinearFilter;
    lutTexture.needsUpdate = true;
    return lutTexture;
}

/**
 * A sky of distant stars on a sphere, with a band where the galactic disk
 * lies. Colours follow the blackbody temperatures of a realistic mix of stars.
 */
export function starfield(radius: number, count: number, seed: number, bandNormal = new THREE.Vector3(0.35, 0.85, 0.4).normalize()): THREE.Points {
    const rng = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const c = [0, 0, 0];
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
        if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) { i--; continue; }
        v.normalize();
        // Half the stars crowd towards the galactic plane.
        if (i % 2 === 0) {
            const d = v.dot(bandNormal);
            v.addScaledVector(bandNormal, -d * 0.85).normalize();
        }
        v.multiplyScalar(radius);
        pos.set([v.x, v.y, v.z], i * 3);
        const T = 2800 + 22_000 * Math.pow(rng(), 3.2);
        blackbodyFast(T, c);
        const mag = Math.pow(rng(), 4);
        const b = 0.15 + 1.6 * mag;
        col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        size[i] = 1.2 + 2.4 * mag;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    const m = spriteMaterial();
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = -10;
    return pts;
}

export function disposeObject(root: THREE.Object3D) {
    root.traverse(o => {
        const any = o as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
        const mat = any.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
    });
}

export function row(label: string, value: string): string {
    return `<div class="row"><span>${label}</span><b>${value}</b></div>`;
}

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Arms an automatic transition only once the camera has been clear of the
 * trigger zone, so arriving at (or returning to) a spot inside it does not
 * immediately fire it again.
 */
export class ProximityTrigger {
    private armed = false;
    private clock = 0;

    constructor(private radius: number, private interval = 0.3) {}

    /** Call every frame with the distance to the nearest candidate (computed only when due). */
    check(dt: number, nearest: () => number): boolean {
        this.clock -= dt;
        if (this.clock > 0) return false;
        this.clock = this.interval;
        const d = nearest();
        if (d > this.radius * 1.5) this.armed = true;
        if (this.armed && d < this.radius) {
            this.armed = false;
            return true;
        }
        return false;
    }
}
