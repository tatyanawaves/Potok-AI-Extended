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
import { progress } from './game/progress';
import { pilotState } from './game/combat';
import { snapshotLogs } from './game/shipGame';
import { GameMenu } from './game/menu';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const ui = {
    crumbs: $('crumbs'), title: $('title'), info: $('info'), actions: $('actions'), targets: $('targets'),
    status: $('status'), help: $('help'), toast: $('toast'), fade: $('fade'), labels: $('labels'), panel: $('panel'),
};

let renderer: THREE.WebGLRenderer;
try {
    // No MSAA on the canvas: every frame goes through the composer's own targets, so it would only cost.
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
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
// The glow is a blur anyway: build it from a half-size image, a quarter of the pixels.
{
    const setSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w: number, h: number) => setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
}
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
    returnDown: () => {
        const below = path[path.length - 1].below;
        if (!below?.length) return false;
        navigate([...path, ...below]);
        return true;
    },
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

const START: LevelRequest[] = [
    { kind: 'web' },
    { kind: 'galaxy', galaxy: MILKY_WAY },
    { kind: 'system', galaxy: MILKY_WAY, star: 'sun' },
];
// Carry on from where the pilot was, if the game was saved.
let path: LevelRequest[] = progress.data.path?.length ? progress.data.path : START;

// ---------------------------------------------------------------------------
// Saving: the pilot, missions, creatures' memories and the place (with the camera there).
// ---------------------------------------------------------------------------
let resetting = false;
function saveGame() {
    if (resetting) return;
    snapshotLogs();
    progress.data.hull = pilotState.hull;
    progress.data.shield = pilotState.shield;
    const here = path[path.length - 1];
    const state = level?.saveState?.();
    if (here && state) here.resume = state;
    progress.data.path = path;
    progress.save();
}
window.addEventListener('beforeunload', saveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

const menu = new GameMenu();
menu.onSave = () => { saveGame(); host.toast('Игра сохранена'); };
menu.onNewGame = () => {
    resetting = true;
    progress.reset();
    location.reload();
};
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
        case 'web': return new CosmicWebLevel(host, r.from);
        case 'galaxy': return new GalaxyLevel(host, r.galaxy, r.from);
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
    // Going up the path: the map marks where the pilot was, and remembers the exact place
    // (the ship's position, the moment in the system) so «вы здесь» leads straight back to it.
    if (next.length < path.length && next[next.length - 1] === path[next.length - 1]) {
        const here = path[path.length - 1];
        const state = level?.saveState?.();
        if (state) here.resume = state;
        const below = path.slice(next.length).map(r => ({ ...r, from: undefined, below: undefined }));
        next[next.length - 1].from = below[0];
        next[next.length - 1].below = below;
    }
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
    saveGame();
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
    // The menu is always there, first in the row.
    const actions = [{ label: '☰ Меню (Tab)', title: 'Навыки, корабль, миссии, сохранение', run: () => menu.toggle() }, ...level.actions()];
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

/**
 * Resolution scale that follows the frame rate: a weak GPU gets fewer pixels instead of a
 * stuttering picture, a strong one gets them back.
 */
let quality = 1;
let slowFor = 0, fastFor = 0, sinceDrop = 1e9;
function adapt(dt: number) {
    sinceDrop += dt;
    if (dt > 1 / 40) { slowFor += dt; fastFor = 0; } else if (dt < 1 / 55) { fastFor += dt; slowFor = 0; } else { slowFor = fastFor = 0; }
    let next = quality;
    if (slowFor > 1.5) next = Math.max(0.5, quality - 0.15);
    // Every change reallocates the render targets (a hitch), so climb back slowly and never
    // soon after a drop: otherwise a GPU on the edge would see-saw and stutter every few seconds.
    if (fastFor > 10 && sinceDrop > 30) next = Math.min(1, quality + 0.1);
    if (next !== quality) {
        if (next < quality) sinceDrop = 0;
        quality = next; slowFor = fastFor = 0; resize();
    }
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, level?.maxPixelRatio ?? 1.25) * quality;
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
    if (e.code === 'Escape' && path.length > 1 && !document.pointerLockElement && performance.now() - unlockedAt > 400 && !menu.isOpen) navigate(path.slice(0, -1));
});
$('toggle-panel').addEventListener('click', () => {
    ui.panel.classList.toggle('collapsed');
    if (level && !ui.panel.classList.contains('collapsed')) ui.info.innerHTML = level.info();
});
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
let fps = 60;
let saveTimer = 15;
renderer.setAnimationLoop(() => {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.1);
    if (raw > 0 && raw < 1) fps += (1 / raw - fps) * 0.05;
    if (!level) return;
    if (!busy && !document.hidden && raw < 0.5) adapt(raw); // a long gap is a hidden tab or a level load, not a slow GPU
    level.update(dt);
    composer.render(dt);
    progress.data.stats.seconds += dt;
    saveTimer -= dt;
    if (saveTimer <= 0 && !busy) { saveTimer = 15; saveGame(); }
    hudTimer -= dt;
    if (hudTimer <= 0) {
        hudTimer = 0.2;
        // The physics notes only while their panel is open: rebuilding hidden HTML is wasted layout.
        if (!ui.panel.classList.contains('collapsed')) ui.info.innerHTML = level.info();
        const perf = `${Math.round(fps)} к/с${quality < 1 ? ` · разрешение ${Math.round(quality * 100)}%` : ''}`;
        ui.status.textContent = `${level.status?.() ?? ''} · ${perf}`;
        renderActions();
    }
});

navigate(path);
// A handle for poking at the running level from the console.
Object.assign(window, {
    universe: {
        get level() { return level; }, renderer, composer, bloom,
        get quality() { return quality; },
        set quality(q: number) { quality = q; resize(); },
    },
});
