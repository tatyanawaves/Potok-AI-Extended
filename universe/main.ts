import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Action, Level, LevelHost, LevelRequest } from './common';
import { MILKY_WAY } from './mandelbrot';
import { virtualKeys } from './flight';
import { CosmicWebLevel } from './levels/cosmicWeb';
import { GalaxyLevel } from './levels/galaxy';
import { StarSystemLevel } from './levels/starSystem';
import { BlackHoleLevel } from './levels/blackHole';
import { PlanetLevel } from './levels/planet';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const ui = {
    crumbs: $('crumbs'), title: $('title'), info: $('info'), actions: $('actions'), targets: $('targets'),
    status: $('status'), help: $('help'), toast: $('toast'), fade: $('fade'), labels: $('labels'), panel: $('panel'),
};

let renderer: THREE.WebGLRenderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
} catch {
    ui.fade.innerHTML = '<p>Нужен браузер с WebGL 2.</p>';
    throw new Error('WebGL unavailable');
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor(0x000000, 1);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.5, 0);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let toastTimer = 0;
const host: LevelHost = {
    renderer,
    canvas,
    labelLayer: ui.labels,
    open: req => navigate([...path, req]),
    warp: next => navigate(next),
    back: () => { if (path.length > 1) navigate(path.slice(0, -1)); },
    saveCamera: (position, quaternion, data) => {
        path[path.length - 1].resume = { position: position.toArray(), quaternion: quaternion.toArray(), data };
    },
    toast: text => {
        ui.toast.textContent = text;
        ui.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), 3200);
    },
};

let path: LevelRequest[] = [
    { kind: 'web' },
    { kind: 'galaxy', galaxy: MILKY_WAY },
    { kind: 'system', galaxy: MILKY_WAY, star: 'sun' },
];
let level: Level | null = null;
let busy = false;

function crumbName(r: LevelRequest): string {
    switch (r.kind) {
        case 'web': return 'Вселенная';
        case 'galaxy': return r.galaxy.name;
        case 'system': return r.star === 'sun' ? 'Солнечная система' : 'Звёздная система';
        case 'blackhole': return r.galaxy.isMilkyWay ? 'Стрелец A*' : 'Чёрная дыра';
        case 'planet': return r.visit.name;
    }
}

function create(r: LevelRequest): Level {
    switch (r.kind) {
        case 'web': return new CosmicWebLevel(host);
        case 'galaxy': return new GalaxyLevel(host, r.galaxy);
        case 'system': return new StarSystemLevel(host, r.galaxy, r.star);
        case 'blackhole': return new BlackHoleLevel(host, r.galaxy);
        case 'planet': return new PlanetLevel(host, r.visit);
    }
}

const nextFrame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

async function navigate(next: LevelRequest[]) {
    if (busy) return;
    busy = true;
    ui.fade.classList.add('on');
    ui.fade.textContent = 'Генерация…';
    await new Promise(res => setTimeout(res, 350));
    await nextFrame();
    level?.dispose();
    level = null;
    path = next;
    try {
        const req = path[path.length - 1];
        level = create(req);
        if (req.resume) {
            level.camera.position.fromArray(req.resume.position);
            level.camera.quaternion.fromArray(req.resume.quaternion);
            level.resumed?.(req.resume);
        }
    } catch (err) {
        console.error(err);
        ui.fade.textContent = 'Не удалось построить сцену';
        busy = false;
        return;
    }
    renderPass.scene = level.scene;
    renderPass.camera = level.camera;
    bloom.strength = level.bloom.strength;
    bloom.radius = level.bloom.radius;
    bloom.threshold = level.bloom.threshold;
    renderCrumbs();
    renderTargets();
    lastActions = '';
    ui.title.textContent = level.title;
    ui.help.textContent = level.help;
    resize();
    ui.fade.classList.remove('on');
    busy = false;
}

function renderCrumbs() {
    ui.crumbs.innerHTML = '';
    path.forEach((r, i) => {
        const b = document.createElement('button');
        b.textContent = crumbName(r);
        b.disabled = i === path.length - 1;
        b.onclick = () => navigate(path.slice(0, i + 1));
        ui.crumbs.appendChild(b);
        if (i < path.length - 1) ui.crumbs.appendChild(Object.assign(document.createElement('span'), { textContent: '›' }));
    });
}

function renderTargets() {
    ui.targets.innerHTML = '';
    const list = level?.targets?.() ?? [];
    ui.targets.style.display = list.length ? '' : 'none';
    for (const a of list) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.onclick = a.run;
        ui.targets.appendChild(b);
    }
}

let lastActions = '';
let currentActions: Action[] = [];
function renderActions() {
    if (!level) return;
    const actions = level.actions();
    const sig = actions.map(a => `${a.label}:${a.active?.() ? 1 : 0}`).join('|');
    currentActions = actions;
    if (sig === lastActions) return;
    lastActions = sig;
    ui.actions.innerHTML = '';
    actions.forEach((a, i) => {
        const b = document.createElement('button');
        b.textContent = a.label;
        if (a.title) b.title = a.title;
        if (a.active) b.classList.toggle('active', a.active());
        b.onclick = () => { currentActions[i]?.run(); lastActions = ''; renderActions(); };
        ui.actions.appendChild(b);
    });
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, level?.maxPixelRatio ?? 1.5);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    level?.resize(w, h);
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    level?.setBufferSize?.(buf.x, buf.y);
}
window.addEventListener('resize', resize);

// A click is a press and release without much movement; a drag steers the camera instead.
let down: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
    if (!down || !level) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 500) {
        level.click?.(e.clientX, e.clientY);
        lastActions = '';
    }
    down = null;
});

let unlockedAt = 0;
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) unlockedAt = performance.now(); });
window.addEventListener('keydown', e => {
    if (e.code === 'KeyH') document.body.classList.toggle('hud-off');
    // Esc first releases a captured mouse; only a free Esc goes up a level.
    if (e.code === 'Escape' && path.length > 1 && !document.pointerLockElement && performance.now() - unlockedAt > 400) navigate(path.slice(0, -1));
});
$('toggle-panel').addEventListener('click', () => ui.panel.classList.toggle('collapsed'));
// The physics notes start folded, so the view is the game; ▾ opens them.
ui.panel.classList.add('collapsed');

// The on-screen pad for touch screens holds virtual keys while a finger is on a button.
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(b => {
    const key = b.dataset.key!;
    const release = () => { virtualKeys.delete(key); b.classList.remove('held'); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); virtualKeys.add(key); b.classList.add('held'); });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
});

const clock = new THREE.Clock();
let hudTimer = 0;
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!level) return;
    level.update(dt);
    composer.render(dt);
    hudTimer -= dt;
    if (hudTimer <= 0) {
        hudTimer = 0.2;
        ui.info.innerHTML = level.info();
        ui.status.textContent = level.status?.() ?? '';
        renderActions();
    }
});

navigate(path);
// A handle for poking at the running level from the console.
Object.assign(window, { universe: { get level() { return level; } } });
