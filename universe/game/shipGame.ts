// The game layer over a star system: the ship and its third-person camera,
// shooting, enemies, missions and the cockpit HUD.

import * as THREE from 'three';
import type { Action } from '../common';
import { virtualKeys } from '../flight';
import { UNIT_KM } from '../physics';
import { Combat, CombatOptions } from './combat';
import { kill, mission, Mission, MissionLog, objectiveText, reach } from './missions';
import { Creatures, CreatureSpec, DialogBox, TALK_KM } from './creatures';
import type { QuestOffer, WorldBrief } from './dialogue';
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
    /** Where the pilot looks; the camera follows this, the hull chases it. Defaults to the hull. */
    aim?: THREE.Quaternion;
    /** Hull yaw and pitch rates (rad/s), for banking. */
    turnRate?: number;
    pitchRate?: number;
    boost?: boolean;
    /** Sideways thrust input (−1…1), which also banks the hull. */
    strafe?: number;
}

type EnemyGroup = { kind: import('./models').EnemyKind; count: number }[];

/** What you might run into between the planets. */
const ENCOUNTERS: { weight: number; text: string; groups: EnemyGroup }[] = [
    { weight: 20, text: 'Перехват! Звено дронов-разведчиков', groups: [{ kind: 'drone', count: 5 }] },
    { weight: 18, text: 'Пиратская засада!', groups: [{ kind: 'fighter', count: 3 }, { kind: 'drone', count: 2 }] },
    { weight: 15, text: 'Рой кристаллидов идёт на таран!', groups: [{ kind: 'crystal', count: 9 }] },
    { weight: 15, text: 'Стая перехватчиков заходит на вас зигзагом!', groups: [{ kind: 'interceptor', count: 4 }] },
    { weight: 10, text: 'Канонерка с эскортом! Держитесь подальше от её залпов', groups: [{ kind: 'gunship', count: 1 }, { kind: 'fighter', count: 2 }] },
    { weight: 8, text: 'Улей! Уничтожьте его, пока он не выпустил весь рой', groups: [{ kind: 'hive', count: 1 }, { kind: 'drone', count: 2 }] },
    { weight: 8, text: 'Пираты гонят рой кристаллидов на вас!', groups: [{ kind: 'fighter', count: 2 }, { kind: 'crystal', count: 5 }] },
    { weight: 6, text: 'Из темноты выплывает космический левиафан…', groups: [{ kind: 'leviathan', count: 1 }, { kind: 'crystal', count: 3 }] },
];

export class ShipGame {
    view: 'first' | 'third' = 'third';
    /** Set when something (a shot, an ambush) needs the pilot at the controls. */
    wantsFree = false;
    readonly combat: Combat;
    readonly log: MissionLog;
    private ship = makeShip();
    private sun = new THREE.DirectionalLight(0xffffff, 2.2);
    private fill = new THREE.HemisphereLight(0x7d8aa8, 0x2a2018, 0.7);
    // Animation state of the hull: bank and lean.
    private bank = 0;
    private lean = 0;
    /** Which gun fires next. */
    private gun = 0;
    private time = 0;
    private mouseFiring = false;
    /** Seconds until the next chance of running into something in open space. */
    private encounterIn = 12 + Math.random() * 10;
    private keys = new Set<string>();
    private mouse: THREE.Vector2 | null = null;
    private deadFor = -1;
    private hud: { root: HTMLElement; hull: HTMLElement; shield: HTMLElement; score: HTMLElement; tracker: HTMLElement; panel: HTMLElement; flash: HTMLElement; cross: HTMLElement };
    private hudClock = 0;
    private lastPilot: THREE.PerspectiveCamera | null = null;

    private onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        this.keys.add(e.code);
        if (e.code === 'Space') e.preventDefault();
        if (e.code === 'KeyV') this.toggleView();
        if (e.code === 'KeyM') this.togglePanel();
        if (e.code === 'KeyT') this.talk();
    };
    private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    private onMouseDown = (e: MouseEvent) => {
        if (e.button === 0 && document.pointerLockElement === this.canvas) this.mouseFiring = true;
    };
    private onMouseUp = (e: MouseEvent) => { if (e.button === 0) this.mouseFiring = false; };
    private onPointer = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') { this.mouse = null; return; }
        const r = this.canvas.getBoundingClientRect();
        this.mouse = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    /** Scene units per km and per metre. */
    private readonly KM: number;
    /** Camera position relative to the pilot, as last placed. */
    private camOffset = new THREE.Vector3();
    private readonly M: number;

    constructor(
        private scene: THREE.Scene, private canvas: HTMLCanvasElement, labelLayer: HTMLElement,
        key: string, missions: () => Mission[], private bodyByName: (name: string) => BodyLike | undefined, private toast: (t: string) => void,
        combat: CombatOptions = {},
        /** Chance meetings with enemies, away from any mission. */
        private encounters = true,
        /** Creatures to talk to, and what they may know of the system. */
        social?: { creatures: CreatureSpec[]; world: WorldBrief },
    ) {
        this.KM = combat.unitsPerKm ?? 1 / UNIT_KM;
        this.M = this.KM / 1000;
        this.ship.scale.setScalar(this.M);
        this.ship.visible = false;
        scene.add(this.ship, this.sun, this.sun.target, this.fill);
        this.combat = new Combat(scene, labelLayer, combat);
        if (social?.creatures.length) {
            this.creatures = new Creatures(scene, social.creatures, this.KM);
            this.world = social.world;
            this.dialog = new DialogBox();
            this.dialog.onQuest = (q, spec) => this.takeErrand(q, spec);
        }
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
            <div id="hitflash"></div>
            <div id="crosshair" class="hud" hidden><i></i></div>`;
        document.body.appendChild(root);
        this.hud = {
            root,
            hull: root.querySelector('.hull b')!,
            shield: root.querySelector('.shield b')!,
            score: root.querySelector('.score b')!,
            tracker: root.querySelector('#tracker')!,
            panel: root.querySelector('#missions')!,
            flash: root.querySelector('#hitflash')!,
            cross: root.querySelector('#crosshair')!,
        };
        this.combat.onHit = () => {
            this.hud.cross.classList.remove('hit');
            void this.hud.cross.offsetWidth;
            this.hud.cross.classList.add('hit');
        };
        this.renderPanel();

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
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
            el.querySelector('small')!.textContent = `${m.giver ? `От: ${m.giver} · ` : ''}Где: ${m.location} · награда ${m.reward} ${state ? '· ' + state : ''}`;
            if (m.state !== 'done' && m.state !== 'active') {
                const btn = document.createElement('button');
                const open = this.log.unlocked(m);
                btn.textContent = !open ? '🔒' : m.state === 'failed' ? 'Повторить' : 'Взять';
                btn.disabled = !open;
                btn.title = open ? '' : 'Сначала выполните предыдущую миссию';
                btn.onclick = () => {
                    if (!this.log.accept(m.id, this.lastNow)) return;
                    this.toast(`Миссия: «${m.title}». Цель — ${m.location}`);
                    this.renderPanel();
                };
                el.appendChild(btn);
                if (!open) el.classList.add('locked');
            }
            p.appendChild(el);
        }
        p.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { p.hidden = true; };
    }

    private lastNow = 0;

    private creatures: Creatures | null = null;
    private dialog: DialogBox | null = null;
    private world: WorldBrief = { system: '', bodies: [] };
    /** The creature within talking range, if any. */
    private near: ReturnType<Creatures['update']> = null;
    /** Errands handed out, by creature id: the mission they became. */
    private errands = new Map<string, Mission>();

    /** Creatures of this system and where they are now (positions update in place). */
    get residents(): { name: string; emoji: string; pos: THREE.Vector3 }[] {
        return (this.creatures?.all ?? []).map(c => ({ name: c.spec.name, emoji: c.spec.emoji, pos: c.pos }));
    }

    /** Move the creatures with their home worlds (call after the bodies move, before the ship does). */
    placeResidents() {
        this.creatures?.place(this.time, this.bodyByName);
    }

    /** A conversation is on: the ship holds still and does not shoot. */
    get talking(): boolean { return !!this.dialog?.open; }

    talk() {
        if (!this.dialog || !this.near || this.dialog.open) return;
        const spec = this.near.c.spec;
        const m = this.errands.get(spec.id);
        const state = !m ? 'none' : m.state === 'active' ? 'active' : m.state === 'done' ? 'done' : 'none';
        if (state === 'done') this.errands.delete(spec.id);
        this.dialog.start(spec, this.world, state);
    }

    private takeErrand(q: QuestOffer, spec: CreatureSpec) {
        const m = q.type === 'kill'
            ? mission(`side-${spec.id}`, q.title, q.brief, q.body, [{ kind: q.enemy!, count: q.count! }], [kill(q.enemy!, q.count!)], q.reward)
            : mission(`side-${spec.id}`, q.title, q.brief, q.body, [], [reach(q.body, 30_000)], q.reward);
        m.giver = spec.name;
        this.log.addSide(m, this.lastNow);
        this.errands.set(spec.id, m);
        this.renderPanel();
        this.toast(`Поручение от ${spec.name}: «${m.title}». Цель — ${m.location}`);
    }

    /** Where the active mission wants the pilot to go, for the planet label. */
    get objectiveBody(): string | null {
        const o = this.log.current();
        if (!o) return null;
        return o.type === 'kill' ? this.log.active!.location : o.body;
    }

    /** Speed cap while enemies are close, km/s → scene units/s. */
    speedLimit(pilotPos: THREE.Vector3, boosted: boolean): number {
        const local = this.combat.toLocal(pilotPos);
        let limit = this.combat.engaged(local) ? (boosted ? 40 : 4) * this.KM : Infinity;
        // Easing in towards a creature, the way the ship slows near a surface, so it is not overshot.
        const km = this.creatures?.nearestKm(pilotPos) ?? Infinity;
        if (km < 50_000) limit = Math.min(limit, Math.max(1, (km - TALK_KM * 0.3) * 0.7) * this.KM * (boosted ? 5 : 1));
        return limit;
    }

    actions(): Action[] {
        const active = this.log.active?.state === 'active';
        return [
            { label: `🎯 Миссии${active ? ' ●' : ''} (M)`, title: 'Список заданий', run: () => this.togglePanel(), active: () => !this.hud.panel.hidden },
            { label: this.view === 'third' ? '👁 Вид из кабины (V)' : '🚀 Вид от 3-го лица (V)', run: () => this.toggleView() },
            ...(this.near && !this.talking
                ? [{ label: `💬 Поговорить: ${this.near.c.spec.name} (T)`, title: this.near.c.spec.species, run: () => this.talk() }]
                : []),
        ];
    }

    update(dt: number, f: FrameContext) {
        this.lastNow = f.now;
        this.lastPilot = f.pilot;
        this.time += dt;
        const locked = document.pointerLockElement === this.canvas;
        const firing = !this.talking && (this.keys.has('Space') || virtualKeys.has('Space') || this.mouseFiring);
        if (firing && !f.free) this.wantsFree = true;

        // The combat frame rides along with the nearest body until a mission pins it somewhere.
        if (!this.combat.anchor || (this.combat.enemyCount === 0 && this.combat.anchor.name !== f.nearest.name)) {
            this.combat.anchor = f.nearest;
        }

        if (this.creatures) {
            const was = this.near?.c;
            this.near = this.creatures.update(this.time, f.pilot.position);
            const c = this.near?.c;
            const h = this.creatures.hailed;
            // It calls out as the ship comes near, and again (with the key to press) in talking range.
            if (c && c !== was && !this.talking) this.toast(`${c.spec.emoji} ${c.spec.name}: «${c.spec.script.hail}» — T, поговорить`);
            else if (h && !this.talking) this.toast(`${h.spec.emoji} ${h.spec.name}: «${h.spec.script.hail}»`);
        }

        // Missions: ambushes spring when the ship nears the mission's body.
        const m = this.log.active;
        if (m && m.state === 'active' && !m.spawned) {
            const body = this.bodyByName(m.location);
            if (body && (f.pilot.position.distanceTo(body.pos) - body.radius) / this.KM < m.triggerKm) {
                m.spawned = true;
                if (m.spawn.length) {
                    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(f.pilot.quaternion);
                    for (const s of m.spawn) this.combat.spawn(s.kind, body, f.pilot.position, s.count, ahead);
                    this.toast('Контакт! Пробел — огонь, мышь — прицел, V — вид');
                    this.wantsFree = true;
                }
            }
        }
        // Open space is not empty: now and then something finds you.
        // A quiet spell after a fight, then the next wave; a lone straggler does not hold it up.
        if (this.encounters && f.free && this.combat.enemyCount <= 1 && !this.combat.player.dead && !this.talking) {
            this.encounterIn -= dt;
            if (this.encounterIn <= 0) {
                this.encounterIn = 25 + Math.random() * 25;
                let r = Math.random() * 100;
                const e = ENCOUNTERS.find(x => (r -= x.weight) < 0) ?? ENCOUNTERS[0];
                const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(f.pilot.quaternion);
                for (const g of e.groups) this.combat.spawn(g.kind, f.nearest, f.pilot.position, g.count, ahead);
                this.toast(`${e.text} Пробел/ЛКМ — огонь`);
            }
        }

        this.log.proximity(name => {
            const b = this.bodyByName(name);
            return b ? (f.pilot.position.distanceTo(b.pos) - b.radius) / this.KM : Infinity;
        }, f.now);

        // Shooting: at the crosshair (screen centre) with a captured mouse, else at the cursor,
        // converging on a point 3 km out.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(f.pilot.quaternion);
        if (firing && f.free) {
            const m = !locked && this.mouse ? this.mouse : new THREE.Vector2();
            const look = new THREE.Vector3(m.x, m.y, 0.5).applyMatrix4(f.camera.projectionMatrixInverse)
                .normalize().applyQuaternion(f.camera.quaternion);
            // The camera is placed at the end of the frame, after the pilot has moved (and been
            // carried along with the planet, thousands of km a frame), so a Raycaster from its
            // last pose shoots nowhere near the crosshair: rebuild the eye from this frame's pilot.
            const eye = f.pilot.position.clone().add(this.camOffset);
            // Left and right guns in turn, their tracers converging on the aim point: from behind,
            // a shot straight out of the nose is a dot hidden by the hull; from the wings it is a streak.
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(f.pilot.quaternion);
            const port = f.pilot.position.clone().addScaledVector(forward, 8 * this.M).addScaledVector(right, (this.gun ? 9 : -9) * this.M);
            const dir = eye.addScaledVector(look, 3 * this.KM).sub(port).normalize();
            if (this.combat.fire(port, dir, f.velocity.clone().divideScalar(this.KM))) this.gun ^= 1;
        }
        this.hud.cross.hidden = !f.free || !locked;

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
        const dt = 1 / 60;
        const showShip = f.free && this.view === 'third' && this.deadFor < 0;
        this.ship.visible = showShip;
        // The hull banks into turns and leans with the climb, as an aircraft would look doing it.
        const turn = f.free ? f.turnRate ?? 0 : 0, climb = f.free ? f.pitchRate ?? 0 : 0;
        const strafe = f.free ? f.strafe ?? 0 : 0;
        this.bank += (THREE.MathUtils.clamp(-turn * 0.9 - strafe * 0.5, -1.0, 1.0) - this.bank) * 0.1;
        this.lean += (THREE.MathUtils.clamp(climb * 0.35, -0.35, 0.35) - this.lean) * 0.1;
        const bob = Math.sin(this.time * 1.7) * 0.6 * this.M;
        this.ship.position.copy(f.pilot.position).add(new THREE.Vector3(0, bob, 0).applyQuaternion(f.pilot.quaternion));
        this.ship.quaternion.copy(f.pilot.quaternion)
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lean, 0, this.bank)));
        // Engines: flame length follows thrust, with a flicker; afterburner when boosting.
        const thrust = Math.min(1, f.velocity.length() / this.KM / 5) + (f.boost ? 0.6 : 0);
        const flicker = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 31);
        this.ship.traverse(o => {
            if (o.name === 'flame') o.scale.set(1 + (f.boost ? 0.3 : 0), (0.25 + thrust * 1.6) * flicker, 1 + (f.boost ? 0.3 : 0));
        });
        const aim = f.free && f.aim ? f.aim : f.pilot.quaternion;
        if (showShip) {
            // Behind and above the ship along the gaze, so looking around swings the camera round the hull.
            // Above and behind, looking along the aim (hardly tilted down): the crosshair, where the
            // tracers converge, sits clear above the hull instead of on its canopy.
            const offset = new THREE.Vector3(0, 18, 80).multiplyScalar(this.M).applyQuaternion(aim);
            f.camera.position.copy(f.pilot.position).add(offset);
            this.camOffset.copy(offset);
            f.camera.quaternion.copy(aim).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.02));
        } else {
            f.camera.position.copy(f.pilot.position);
            this.camOffset.set(0, 0, 0);
            f.camera.quaternion.copy(aim);
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
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        this.canvas.removeEventListener('pointermove', this.onPointer);
        this.combat.dispose();
        this.creatures?.dispose();
        this.dialog?.dispose();
        this.hud.root.remove();
        this.scene.remove(this.ship, this.sun, this.sun.target, this.fill);
    }
}
