// The game layer over a star system: the ship and its third-person camera,
// shooting, enemies, missions and the cockpit HUD.

import * as THREE from 'three';
import type { Action } from '../common';
import { virtualKeys } from '../flight';
import { UNIT_KM } from '../physics';
import { Combat, CombatOptions } from './combat';
import { Mission, MissionLog, objectiveText } from './missions';
import { makeShip } from './models';

/** Mission progress per place (a system, or a planet's surface) survives leaving and coming back. */
const logs = new Map<string, MissionLog>();

export interface BodyLike { name: string; pos: THREE.Vector3; radius: number }

export interface FrameContext {
    pilot: THREE.PerspectiveCamera;
    camera: THREE.PerspectiveCamera;
    /** Is the pilot flying the ship (not the orbit camera or the autopilot)? */
    free: boolean;
    /** Ship velocity relative to the local frame, scene units per second. */
    velocity: THREE.Vector3;
    starPos: THREE.Vector3;
    nearest: BodyLike;
    width: number;
    height: number;
    now: number;
}

export class ShipGame {
    view: 'first' | 'third' = 'third';
    /** Set when something (a shot, an ambush) needs the pilot at the controls. */
    wantsFree = false;
    readonly combat: Combat;
    readonly log: MissionLog;
    private ship = makeShip();
    private sun = new THREE.DirectionalLight(0xffffff, 4);
    private fill = new THREE.HemisphereLight(0x8899bb, 0x221a14, 0.8);
    private keys = new Set<string>();
    private mouse: THREE.Vector2 | null = null;
    private deadFor = -1;
    private hud: { root: HTMLElement; hull: HTMLElement; shield: HTMLElement; score: HTMLElement; tracker: HTMLElement; panel: HTMLElement; flash: HTMLElement };
    private hudClock = 0;
    private lastPilot: THREE.PerspectiveCamera | null = null;

    private onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        this.keys.add(e.code);
        if (e.code === 'Space') e.preventDefault();
        if (e.code === 'KeyV') this.toggleView();
        if (e.code === 'KeyM') this.togglePanel();
    };
    private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    private onPointer = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') { this.mouse = null; return; }
        const r = this.canvas.getBoundingClientRect();
        this.mouse = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    /** Scene units per km and per metre. */
    private readonly KM: number;
    private readonly M: number;

    constructor(
        private scene: THREE.Scene, private canvas: HTMLCanvasElement, labelLayer: HTMLElement,
        key: string, missions: () => Mission[], private bodyByName: (name: string) => BodyLike | undefined, private toast: (t: string) => void,
        combat: CombatOptions = {},
    ) {
        this.KM = combat.unitsPerKm ?? 1 / UNIT_KM;
        this.M = this.KM / 1000;
        this.ship.scale.setScalar(this.M);
        this.ship.visible = false;
        scene.add(this.ship, this.sun, this.sun.target, this.fill);
        this.combat = new Combat(scene, labelLayer, combat);
        if (!logs.has(key)) logs.set(key, new MissionLog(missions()));
        this.log = logs.get(key)!;
        this.combat.onKill = kind => this.log.kill(kind);
        this.combat.onPlayerHit = () => {
            this.hud.flash.classList.remove('on');
            void this.hud.flash.offsetWidth;
            this.hud.flash.classList.add('on');
        };
        this.combat.onPlayerDeath = () => {
            this.deadFor = 0;
            this.toast('Корабль уничтожен! Восстановление через 3 с');
        };
        this.log.onComplete = m => {
            this.combat.player.score += m.reward;
            this.toast(`Миссия выполнена: «${m.title}» (+${m.reward})`);
            this.renderPanel();
        };
        this.log.onFail = m => {
            this.toast(`Миссия провалена: «${m.title}»`);
            this.renderPanel();
        };

        const root = document.createElement('div');
        root.className = 'shiphud';
        root.innerHTML = `
            <div id="shipbars" class="hud glass">
                <div><span>Корпус</span><i class="bar hull"><b></b></i></div>
                <div><span>Щит</span><i class="bar shield"><b></b></i></div>
                <div class="score">Очки: <b>0</b></div>
            </div>
            <div id="tracker" class="hud glass"></div>
            <div id="missions" class="hud glass" hidden></div>
            <div id="hitflash"></div>`;
        document.body.appendChild(root);
        this.hud = {
            root,
            hull: root.querySelector('.hull b')!,
            shield: root.querySelector('.shield b')!,
            score: root.querySelector('.score b')!,
            tracker: root.querySelector('#tracker')!,
            panel: root.querySelector('#missions')!,
            flash: root.querySelector('#hitflash')!,
        };
        this.renderPanel();

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        canvas.addEventListener('pointermove', this.onPointer);
    }

    toggleView() {
        this.view = this.view === 'third' ? 'first' : 'third';
        this.wantsFree = true;
    }

    togglePanel() {
        this.hud.panel.hidden = !this.hud.panel.hidden;
        if (!this.hud.panel.hidden) this.renderPanel();
    }

    private renderPanel() {
        const p = this.hud.panel;
        p.innerHTML = '<header><b>Миссии</b><button data-close>✕</button></header>';
        for (const m of this.log.missions) {
            const el = document.createElement('div');
            el.className = `mission ${m.state}`;
            const state = m.state === 'done' ? '✓ выполнена' : m.state === 'active' ? '● активна' : m.state === 'failed' ? '✕ провалена' : '';
            el.innerHTML = `<b></b><p></p><small></small>`;
            el.querySelector('b')!.textContent = m.title;
            el.querySelector('p')!.textContent = m.brief;
            el.querySelector('small')!.textContent = `Где: ${m.location} · награда ${m.reward} ${state ? '· ' + state : ''}`;
            if (m.state !== 'done' && m.state !== 'active') {
                const btn = document.createElement('button');
                btn.textContent = m.state === 'failed' ? 'Повторить' : 'Взять';
                btn.onclick = () => {
                    this.log.accept(m.id, this.lastNow);
                    this.toast(`Миссия: «${m.title}». Цель — ${m.location}`);
                    this.renderPanel();
                };
                el.appendChild(btn);
            }
            p.appendChild(el);
        }
        p.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { p.hidden = true; };
    }

    private lastNow = 0;

    /** Where the active mission wants the pilot to go, for the planet label. */
    get objectiveBody(): string | null {
        const o = this.log.current();
        if (!o) return null;
        return o.type === 'kill' ? this.log.active!.location : o.body;
    }

    /** Speed cap while enemies are close, km/s → scene units/s. */
    speedLimit(pilotPos: THREE.Vector3, boosted: boolean): number {
        const local = this.combat.toLocal(pilotPos);
        if (!this.combat.engaged(local)) return Infinity;
        return (boosted ? 40 : 4) * this.KM;
    }

    actions(): Action[] {
        const active = this.log.active?.state === 'active';
        return [
            { label: `🎯 Миссии${active ? ' ●' : ''} (M)`, title: 'Список заданий', run: () => this.togglePanel(), active: () => !this.hud.panel.hidden },
            { label: this.view === 'third' ? '👁 Вид из кабины (V)' : '🚀 Вид от 3-го лица (V)', run: () => this.toggleView() },
        ];
    }

    update(dt: number, f: FrameContext) {
        this.lastNow = f.now;
        this.lastPilot = f.pilot;
        const firing = this.keys.has('Space') || virtualKeys.has('Space');
        if (firing && !f.free) this.wantsFree = true;

        // The combat frame rides along with the nearest body until a mission pins it somewhere.
        if (!this.combat.anchor || (this.combat.enemyCount === 0 && this.combat.anchor.name !== f.nearest.name)) {
            this.combat.anchor = f.nearest;
        }

        // Missions: ambushes spring when the ship nears the mission's body.
        const m = this.log.active;
        if (m && m.state === 'active' && !m.spawned) {
            const body = this.bodyByName(m.location);
            if (body && (f.pilot.position.distanceTo(body.pos) - body.radius) / this.KM < m.triggerKm) {
                m.spawned = true;
                if (m.spawn.length) {
                    for (const s of m.spawn) this.combat.spawn(s.kind, body, f.pilot.position, s.count);
                    this.toast('Контакт! Пробел — огонь, мышь — прицел, V — вид');
                    this.wantsFree = true;
                }
            }
        }
        this.log.proximity(name => {
            const b = this.bodyByName(name);
            return b ? (f.pilot.position.distanceTo(b.pos) - b.radius) / this.KM : Infinity;
        }, f.now);

        // Shooting: towards the mouse cursor, or straight ahead on touch screens.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(f.pilot.quaternion);
        const nose = f.pilot.position.clone().addScaledVector(forward, 25 * this.M);
        if (firing && f.free) {
            let dir = forward;
            if (this.mouse) {
                const ray = new THREE.Raycaster();
                ray.setFromCamera(this.mouse, f.camera);
                // Converge on a point 3 km out along the cursor ray.
                dir = ray.ray.origin.clone().addScaledVector(ray.ray.direction, 3 * this.KM).sub(nose).normalize();
            }
            this.combat.fire(nose, dir, f.velocity.clone().divideScalar(this.KM));
        }

        this.combat.update(dt, f.pilot.position, f.velocity.clone().divideScalar(this.KM), f.camera, f.width, f.height);

        if (this.deadFor >= 0) {
            this.deadFor += dt;
            if (this.deadFor > 3) {
                this.deadFor = -1;
                this.combat.respawn();
                // Come back a little way off, out of the thick of it.
                f.pilot.position.addScaledVector(forward, -60 * this.KM);
                this.toast('Корабль восстановлен (−200 очков)');
            }
        }

        this.placeCamera(f);
        this.sun.position.copy(f.starPos);
        this.sun.target.position.copy(f.pilot.position);

        this.hudClock -= dt;
        if (this.hudClock <= 0) {
            this.hudClock = 0.1;
            this.renderHud(f.now);
        }
    }

    private placeCamera(f: FrameContext) {
        const showShip = f.free && this.view === 'third' && this.deadFor < 0;
        this.ship.visible = showShip;
        this.ship.position.copy(f.pilot.position);
        this.ship.quaternion.copy(f.pilot.quaternion);
        const thrust = Math.min(1, f.velocity.length() / this.KM / 5);
        this.ship.traverse(o => { if (o.name === 'flame') o.scale.set(1, 0.3 + thrust * 1.5, 1); });
        if (showShip) {
            // Behind and above, looking a little down past the ship.
            const offset = new THREE.Vector3(0, 16, 75).multiplyScalar(this.M).applyQuaternion(f.pilot.quaternion);
            f.camera.position.copy(f.pilot.position).add(offset);
            f.camera.quaternion.copy(f.pilot.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1));
        } else {
            f.camera.position.copy(f.pilot.position);
            f.camera.quaternion.copy(f.pilot.quaternion);
        }
    }

    private renderHud(now: number) {
        const p = this.combat.player;
        this.hud.hull.style.width = `${(p.hull / p.maxHull) * 100}%`;
        this.hud.shield.style.width = `${(p.shield / p.maxShield) * 100}%`;
        this.hud.score.textContent = String(Math.round(p.score));
        const m = this.log.active;
        const t = this.hud.tracker;
        if (!m || m.state !== 'active') {
            t.hidden = true;
            return;
        }
        t.hidden = false;
        t.innerHTML = '';
        const title = document.createElement('b');
        title.textContent = `🎯 ${m.title}`;
        t.appendChild(title);
        for (const o of m.objectives) {
            const line = document.createElement('div');
            line.textContent = objectiveText(o, now, m.startedAt);
            t.appendChild(line);
        }
        if (this.lastPilot) {
            const b = this.bodyByName(this.objectiveBody ?? '');
            if (b) {
                const d = (this.lastPilot.position.distanceTo(b.pos) - b.radius) / this.KM;
                const line = document.createElement('small');
                line.textContent = `До цели: ${d > 1e6 ? `${(d / 1e6).toFixed(1)} млн км` : `${Math.round(d).toLocaleString('ru-RU')} км`}`;
                t.appendChild(line);
            }
        }
    }

    dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        this.canvas.removeEventListener('pointermove', this.onPointer);
        this.combat.dispose();
        this.hud.root.remove();
        this.scene.remove(this.ship, this.sun, this.sun.target, this.fill);
    }
}
