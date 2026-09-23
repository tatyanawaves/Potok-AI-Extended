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

export interface FlyOptions {
    /** Starting throttle, scene units per second. */
    speed: number;
    minSpeed: number;
    maxSpeed: number;
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
    private dragging = false;
    private last = { x: 0, y: 0 };
    private autopilot: { target: () => THREE.Vector3; standoff: number; last: THREE.Vector3 | null } | null = null;

    private onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        this.keys.add(e.code);
        if (MOVE_KEYS.has(e.code)) {
            this.autopilot = null;
            if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
        }
    };
    private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    private onBlur = () => { this.keys.clear(); };
    private onDown = (e: PointerEvent) => {
        if (!this.enabled || e.button > 2) return;
        this.dragging = true;
        this.last = { x: e.clientX, y: e.clientY };
    };
    private onUp = () => { this.dragging = false; };
    private onMove = (e: PointerEvent) => {
        if (!this.dragging || !this.enabled) return;
        const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
        this.last = { x: e.clientX, y: e.clientY };
        // Narrow fields of view turn more slowly, so aiming stays precise.
        const k = 0.0035 * (this.camera.fov / 60);
        this.yaw -= dx * k;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * k));
        this.autopilot = null;
        this.apply();
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

    /** Take over the camera's current orientation (after another mode moved it). */
    sync() {
        const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = e.y;
        this.pitch = Math.max(-1.55, Math.min(1.55, e.x));
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
            this.yaw = e.y; this.pitch = e.x;
            if (Math.abs(dist - this.autopilot.standoff) < this.autopilot.standoff * 0.02) this.autopilot = null;
            return this.velocity.length();
        }
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

    dispose() {
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
