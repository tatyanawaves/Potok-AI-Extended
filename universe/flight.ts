import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Keys held on the on-screen pad of touch devices; every controller reads them too. */
export const virtualKeys = new Set<string>();

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyE', 'KeyR', 'PageUp'];
const DOWN = ['KeyQ', 'KeyF', 'PageDown'];
export const MOVE_KEYS = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...UP, ...DOWN]);

export const FLY_HELP = 'WASD / стрелки — лететь · Q/E — вниз/вверх · Shift — ×10 · мышь (зажать) — смотреть · колесо — скорость';
export const SHIP_HELP = 'Клик — захватить мышь · мышь — обзор и курс · ПКМ или C — оглядеться (в т.ч. назад) · WASD — тяга · Q/E — вниз/вверх · Shift — форсаж · колесо — скорость';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface FlyOptions {
    /** Starting throttle, scene units per second. */
    speed: number;
    minSpeed: number;
    maxSpeed: number;
    /**
     * A ship rather than a floating camera: the mouse sets where you look, the
     * hull turns after it at a finite rate, and a click captures the mouse.
     */
    ship?: boolean;
}

/**
 * Free flight as in a game: WASD or the arrows move, holding the mouse button
 * and dragging turns the view (yaw about "up", pitch clamped so the horizon
 * never flips), the wheel sets the throttle, Shift boosts. The ship eases in
 * and out of motion and stops when no key is held.
 */
export class FlyController {
    enabled = true;
    speed: number;
    readonly velocity = new THREE.Vector3();
    private keys = new Set<string>();
    private yaw = 0;
    private pitch = 0;
    /** Where the pilot is looking; for a ship the hull chases it. */
    private aimYaw = 0;
    private aimPitch = 0;
    /** Looking around without turning the ship (right mouse button or C). */
    private freeLook = false;
    private returning = false;
    /** Yaw and pitch rates of the hull, rad/s, for banking animations. */
    turnRate = 0;
    pitchRate = 0;
    private dragging = false;
    private last = { x: 0, y: 0 };
    private autopilot: { target: () => THREE.Vector3; standoff: number; last: THREE.Vector3 | null } | null = null;

    private onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        this.keys.add(e.code);
        if (e.code === 'KeyC') this.setFreeLook(true);
        if (MOVE_KEYS.has(e.code)) {
            this.autopilot = null;
            if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
        }
    };
    private onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code);
        if (e.code === 'KeyC') this.setFreeLook(false);
    };
    private onBlur = () => { this.keys.clear(); this.setFreeLook(false); };
    private onDown = (e: PointerEvent) => {
        if (!this.enabled || e.button > 2) return;
        if (e.button === 2) this.setFreeLook(true);
        if (this.opts.ship && e.button === 0 && e.pointerType === 'mouse' && !this.locked) {
            // The first click hands the mouse to the ship; Esc gives it back.
            (this.dom as HTMLElement).requestPointerLock?.();
        }
        this.dragging = true;
        this.last = { x: e.clientX, y: e.clientY };
    };
    private onUp = (e: PointerEvent) => {
        this.dragging = false;
        if (e.button === 2) this.setFreeLook(false);
    };
    private onMove = (e: PointerEvent) => {
        if (!this.enabled) return;
        let dx: number, dy: number;
        if (this.locked) { dx = e.movementX; dy = e.movementY; }
        else if (this.dragging) {
            dx = e.clientX - this.last.x; dy = e.clientY - this.last.y;
            this.last = { x: e.clientX, y: e.clientY };
        } else return;
        // Narrow fields of view turn more slowly, so aiming stays precise.
        const k = (this.locked ? 0.0022 : 0.0035) * (this.camera.fov / 60);
        this.aimYaw -= dx * k;
        this.aimPitch = Math.max(-1.55, Math.min(1.55, this.aimPitch - dy * k));
        this.autopilot = null;
        this.returning = false;
        if (!this.opts.ship) {
            this.yaw = this.aimYaw;
            this.pitch = this.aimPitch;
            this.apply();
        }
    };
    private onWheel = (e: WheelEvent) => {
        if (!this.enabled) return;
        this.speed = Math.max(this.opts.minSpeed, Math.min(this.opts.maxSpeed, this.speed * Math.exp(-e.deltaY * 0.0015)));
    };
    private onContext = (e: Event) => e.preventDefault();

    constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private opts: FlyOptions) {
        this.speed = opts.speed;
        this.sync();
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);
        dom.addEventListener('pointerdown', this.onDown);
        window.addEventListener('pointerup', this.onUp);
        window.addEventListener('pointercancel', this.onUp);
        window.addEventListener('pointermove', this.onMove);
        dom.addEventListener('wheel', this.onWheel, { passive: true });
        dom.addEventListener('contextmenu', this.onContext);
    }

    get locked(): boolean {
        return document.pointerLockElement === this.dom;
    }

    private setFreeLook(on: boolean) {
        if (this.freeLook === on) return;
        this.freeLook = on;
        // Letting go swings the view back behind the ship.
        if (!on) this.returning = true;
    }

    /** Where the pilot looks (for a ship this can differ from where the hull points). */
    get aimQuaternion(): THREE.Quaternion {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(this.aimPitch, this.aimYaw, 0, 'YXZ'));
    }

    /** Take over the camera's current orientation (after another mode moved it). */
    sync() {
        const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = this.aimYaw = e.y;
        this.pitch = this.aimPitch = Math.max(-1.55, Math.min(1.55, e.x));
        this.returning = false;
        this.apply();
    }

    private apply() {
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    }

    private held(codes: string[]) {
        return codes.some(c => this.keys.has(c) || virtualKeys.has(c)) ? 1 : 0;
    }

    /** Is the pilot pressing any movement key right now? */
    get steering(): boolean {
        for (const c of MOVE_KEYS) if (this.keys.has(c) || virtualKeys.has(c)) return true;
        return false;
    }

    get boosted(): boolean {
        return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || virtualKeys.has('ShiftLeft');
    }

    get flyingTo(): boolean { return this.autopilot !== null; }

    /** Glide up to a (possibly moving) point and stop `standoff` short of it, facing it. */
    flyTo(target: () => THREE.Vector3, standoff: number) {
        this.autopilot = { target, standoff, last: null };
    }

    stop() {
        this.velocity.set(0, 0, 0);
        this.autopilot = null;
    }

    /** Move the camera; `limit` caps the speed (e.g. near a planet). Returns the speed reached. */
    update(dt: number, limit = Infinity): number {
        if (!this.enabled) return 0;
        const cam = this.camera;
        if (this.autopilot) {
            const ap = this.autopilot;
            const target = ap.target().clone();
            // Ride along with a moving target, then close the remaining gap.
            if (ap.last) cam.position.add(new THREE.Vector3().subVectors(target, ap.last));
            ap.last = target.clone();
            const to = new THREE.Vector3().subVectors(target, cam.position);
            const dist = to.length();
            const goal = target.clone().addScaledVector(to.normalize(), -this.autopilot.standoff);
            const before = cam.position.clone();
            // `before` is taken after riding along, so this is the speed relative to the target.
            cam.position.lerp(goal, 1 - Math.exp(-2.2 * dt));
            this.velocity.subVectors(cam.position, before).divideScalar(Math.max(dt, 1e-6));
            const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, target, new THREE.Vector3(0, 1, 0)));
            cam.quaternion.slerp(look, 1 - Math.exp(-4 * dt));
            const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
            this.yaw = this.aimYaw = e.y; this.pitch = this.aimPitch = e.x;
            if (Math.abs(dist - this.autopilot.standoff) < this.autopilot.standoff * 0.02) this.autopilot = null;
            return this.velocity.length();
        }
        if (this.opts.ship) this.steer(dt);
        const dir = new THREE.Vector3(
            this.held(RIGHT) - this.held(LEFT),
            this.held(UP) - this.held(DOWN),
            this.held(BACK) - this.held(FORWARD),
        );
        const max = Math.min(this.speed * (this.boosted ? 10 : 1), limit);
        if (dir.lengthSq() > 0) dir.normalize().applyQuaternion(cam.quaternion).multiplyScalar(max);
        // Ease towards the wanted velocity: quick to respond, no jerk, and a glide to a stop.
        this.velocity.lerp(dir, 1 - Math.exp(-5 * dt));
        if (this.velocity.length() > max) this.velocity.setLength(max);
        if (dir.lengthSq() === 0 && this.velocity.length() < max * 1e-3) this.velocity.set(0, 0, 0);
        cam.position.addScaledVector(this.velocity, dt);
        return this.velocity.length();
    }

    /** The hull turns after the pilot's gaze, quickly but not instantly (at most ~2.5 rad/s). */
    private steer(dt: number) {
        if (this.returning) {
            const k = 1 - Math.exp(-7 * dt);
            this.aimYaw += wrapAngle(this.yaw - this.aimYaw) * k;
            this.aimPitch += (this.pitch - this.aimPitch) * k;
            if (Math.abs(wrapAngle(this.yaw - this.aimYaw)) + Math.abs(this.pitch - this.aimPitch) < 0.005) this.returning = false;
        }
        let dYaw = 0, dPitch = 0;
        if (!this.freeLook && !this.returning) {
            const k = 1 - Math.exp(-5 * dt), cap = 2.5 * dt;
            dYaw = THREE.MathUtils.clamp(wrapAngle(this.aimYaw - this.yaw) * k, -cap, cap);
            dPitch = THREE.MathUtils.clamp((this.aimPitch - this.pitch) * k, -cap, cap);
            this.yaw += dYaw;
            this.pitch += dPitch;
        }
        const r = 1 - Math.exp(-8 * dt);
        this.turnRate += (dYaw / Math.max(dt, 1e-4) - this.turnRate) * r;
        this.pitchRate += (dPitch / Math.max(dt, 1e-4) - this.pitchRate) * r;
        this.apply();
    }

    dispose() {
        if (this.locked) document.exitPointerLock?.();
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.dom.removeEventListener('pointerdown', this.onDown);
        window.removeEventListener('pointerup', this.onUp);
        window.removeEventListener('pointercancel', this.onUp);
        window.removeEventListener('pointermove', this.onMove);
        this.dom.removeEventListener('wheel', this.onWheel);
        this.dom.removeEventListener('contextmenu', this.onContext);
    }
}

/**
 * Free flight by default, with an orbit camera around a point as the other
 * mode. Pressing a movement key while orbiting hands control back to the pilot.
 */
export class Navigator {
    readonly fly: FlyController;
    readonly orbit: OrbitControls;
    mode: 'free' | 'orbit' = 'free';

    constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, opts: FlyOptions, orbit: { min: number; max: number }) {
        this.fly = new FlyController(camera, dom, opts);
        this.orbit = new OrbitControls(camera, dom);
        this.orbit.enableDamping = true;
        this.orbit.minDistance = orbit.min;
        this.orbit.maxDistance = orbit.max;
        this.orbit.enabled = false;
    }

    /** Point the camera at p without moving it, then keep flying freely. */
    lookAt(p: THREE.Vector3) {
        this.camera.lookAt(p);
        this.fly.sync();
    }

    setOrbit(target: THREE.Vector3, autoRotate = false) {
        this.mode = 'orbit';
        this.fly.stop();
        this.fly.enabled = false;
        this.orbit.target.copy(target);
        this.orbit.autoRotate = autoRotate;
        this.orbit.enabled = true;
        this.orbit.update();
    }

    setFree() {
        if (this.mode === 'free') return;
        this.mode = 'free';
        this.orbit.enabled = false;
        this.orbit.autoRotate = false;
        this.fly.enabled = true;
        this.fly.sync();
    }

    flyTo(target: () => THREE.Vector3, standoff: number) {
        this.setFree();
        this.fly.flyTo(target, standoff);
    }

    /** Returns the camera's speed in free flight (0 while orbiting). */
    update(dt: number, limit = Infinity): number {
        if (this.mode === 'orbit' && this.fly.steering) this.setFree();
        if (this.mode === 'free') return this.fly.update(dt, limit);
        this.orbit.update(dt);
        return 0;
    }

    dispose() {
        this.fly.dispose();
        this.orbit.dispose();
    }
}
