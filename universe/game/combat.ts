// Ship combat. Everything here lives in kilometres, in a frame riding along
// with an anchor body (the planet the fight is near), so a battle is not torn
// apart by the planet's orbital motion. Meshes are placed into scene units
// every frame: 10⁶ km in a star system, metres on a planet's surface.

import * as THREE from 'three';
import { UNIT_KM } from '../physics';
import { EnemyKind, makeEnemy } from './models';


export interface Anchor { name: string; pos: THREE.Vector3 }

interface EnemyDef {
    name: string;
    hp: number;
    speed: number;       // km/s
    hitKm: number;       // hit sphere radius
    preferKm: number;    // distance it likes to keep
    fireEvery: number;   // s, 0 = never shoots
    boltSpeed: number;   // km/s
    boltDamage: number;
    contactDamage: number;
    score: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
    drone: { name: 'Дрон-разведчик', hp: 40, speed: 2.2, hitKm: 0.09, preferKm: 3, fireEvery: 1.6, boltSpeed: 12, boltDamage: 6, contactDamage: 10, score: 50 },
    fighter: { name: 'Пиратский штурмовик', hp: 90, speed: 4, hitKm: 0.12, preferKm: 1.5, fireEvery: 0.7, boltSpeed: 16, boltDamage: 7, contactDamage: 20, score: 120 },
    crystal: { name: 'Кристаллид', hp: 20, speed: 5, hitKm: 0.07, preferKm: 0, fireEvery: 0, boltSpeed: 0, boltDamage: 0, contactDamage: 25, score: 30 },
    leviathan: { name: 'Космический левиафан', hp: 700, speed: 1.1, hitKm: 0.5, preferKm: 2.5, fireEvery: 2.2, boltSpeed: 7, boltDamage: 22, contactDamage: 40, score: 1000 },
};

export const PLAYER_BOLT_SPEED = 25; // km/s relative to the ship
const PLAYER_BOLT_DAMAGE = 20;
const PLAYER_HIT_KM = 0.04;
const FIRE_INTERVAL = 0.12;

interface Enemy {
    kind: EnemyKind;
    def: EnemyDef;
    mesh: THREE.Group;
    hp: number;
    local: THREE.Vector3;
    vel: THREE.Vector3;
    cooldown: number;
    phase: number;
    breakTimer: number;
    label: HTMLDivElement;
    bar: HTMLElement;
    text: HTMLElement;
    /** Arrow at the screen edge while the enemy is off screen or behind. */
    arrow: HTMLDivElement;
}

interface Bolt {
    local: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    damage: number;
    friendly: boolean;
    radius: number;
    mesh: THREE.Mesh;
}

interface Burst {
    points: THREE.Points;
    local: THREE.Vector3;
    vel: Float32Array;
    offs: Float32Array;
    life: number;
    maxLife: number;
}

export interface CombatOptions {
    /** Scene units per kilometre (10⁻⁶ in a star system, 1000 on a surface). */
    unitsPerKm?: number;
    /** Terrain height (km) under a point (km), so creatures stay above the ground. */
    ground?: (xKm: number, zKm: number) => number;
}

export interface PlayerState {
    hull: number;
    maxHull: number;
    shield: number;
    maxShield: number;
    score: number;
    sinceHit: number;
    dead: boolean;
}

const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2);
const friendlyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x66ddff).multiplyScalar(6) });
const hostileMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3344).multiplyScalar(6) });
const plasmaMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcc44ff).multiplyScalar(6) });

export const pilotState: PlayerState = { hull: 100, maxHull: 100, shield: 100, maxShield: 100, score: 0, sinceHit: 99, dead: false };

export class Combat {
    readonly group = new THREE.Group();
    /** One pilot across every level: score, hull and shield carry over. */
    readonly player: PlayerState = pilotState;
    anchor: Anchor | null = null;
    onKill?: (kind: EnemyKind) => void;
    onPlayerHit?: () => void;
    /** A player's shot connected (for the hit marker). */
    onHit?: () => void;
    onPlayerDeath?: () => void;
    private enemies: Enemy[] = [];
    private bolts: Bolt[] = [];
    private bursts: Burst[] = [];
    private fireCooldown = 0;
    private labelLayer: HTMLDivElement;
    private time = 0;
    private v = new THREE.Vector3();
    private readonly KM: number;
    private readonly M: number;
    private ground?: (xKm: number, zKm: number) => number;

    constructor(private scene: THREE.Scene, layer: HTMLElement, opts: CombatOptions = {}) {
        this.KM = opts.unitsPerKm ?? 1 / UNIT_KM;
        this.M = this.KM / 1000;
        this.ground = opts.ground;
        scene.add(this.group);
        this.labelLayer = document.createElement('div');
        layer.appendChild(this.labelLayer);
    }

    get enemyCount() { return this.enemies.length; }

    /** Any hostile close enough that the ship should fight rather than cruise. */
    engaged(playerLocal: THREE.Vector3 | null): boolean {
        if (!playerLocal) return false;
        return this.enemies.some(e => e.local.distanceTo(playerLocal) < 80);
    }

    /** The player's position in the combat frame, km. */
    toLocal(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 | null {
        if (!this.anchor) return null;
        return out.subVectors(world, this.anchor.pos).divideScalar(this.KM);
    }

    /** Other things bolts can hit (rocks): hit() returns true when the target breaks. */
    extraTargets?: () => { local: THREE.Vector3; radiusKm: number; hit: (damage: number) => boolean }[];

    toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(local).multiplyScalar(this.KM).add(this.anchor!.pos);
    }

    /** Put `count` enemies on a shell 2.5–6 km around a point (in the anchor's frame): close enough to see and fight. */
    spawn(kind: EnemyKind, anchor: Anchor, aroundWorld: THREE.Vector3, count: number) {
        if (this.anchor && this.anchor !== anchor) this.clear();
        this.anchor = anchor;
        const center = this.toLocal(aroundWorld)!;
        const def = ENEMIES[kind];
        for (let i = 0; i < count; i++) {
            const dir = new THREE.Vector3().randomDirection();
            const mesh = makeEnemy(kind);
            mesh.scale.setScalar(this.M);
            this.group.add(mesh);
            const label = document.createElement('div');
            label.className = 'elabel';
            label.innerHTML = `<span></span><i><b></b></i>`;
            this.labelLayer.appendChild(label);
            const arrow = document.createElement('div');
            arrow.className = 'earrow';
            this.labelLayer.appendChild(arrow);
            this.enemies.push({
                kind, def, mesh, hp: def.hp,
                local: center.clone().addScaledVector(dir, kind === 'leviathan' ? 7 : 2.5 + Math.random() * 3.5), arrow,
                vel: new THREE.Vector3(), cooldown: 1 + Math.random() * 2, phase: Math.random() * 10, breakTimer: 0,
                label, text: label.querySelector('span')!, bar: label.querySelector('b')!,
            });
        }
    }

    clear() {
        for (const e of this.enemies) this.removeEnemy(e);
        this.enemies = [];
        for (const b of this.bolts) this.group.remove(b.mesh);
        this.bolts = [];
    }

    private removeEnemy(e: Enemy) {
        this.group.remove(e.mesh);
        e.mesh.traverse(o => (o as THREE.Mesh).geometry?.dispose());
        e.label.remove();
        e.arrow.remove();
    }

    /**
     * Fire from the ship along `dirWorld`. A gentle aim assist bends the shot
     * onto the lead point of an enemy within a few degrees of the aim.
     */
    fire(shipWorld: THREE.Vector3, dirWorld: THREE.Vector3, shipVelKmS: THREE.Vector3): boolean {
        if (!this.anchor || this.fireCooldown > 0 || this.player.dead) return false;
        this.fireCooldown = FIRE_INTERVAL;
        const from = this.toLocal(shipWorld)!;
        const ray = dirWorld.clone().normalize();
        let dir = ray.clone();
        let best = Math.cos((6 * Math.PI) / 180);
        for (const e of this.enemies) {
            const to = this.v.subVectors(e.local, from);
            const d = to.length();
            if (d > 40) continue;
            const c = to.dot(ray) / d;
            if (c > best) {
                best = c;
                const t = d / PLAYER_BOLT_SPEED;
                dir = e.local.clone().addScaledVector(e.vel, t).sub(from).normalize();
            }
        }
        const vel = dir.multiplyScalar(PLAYER_BOLT_SPEED).add(shipVelKmS);
        this.addBolt(from.addScaledVector(vel.clone().normalize(), 0.03), vel, PLAYER_BOLT_DAMAGE, true, 0.004, friendlyMat, 2.5);
        return true;
    }

    private addBolt(local: THREE.Vector3, vel: THREE.Vector3, damage: number, friendly: boolean, radius: number, mat: THREE.Material, life: number) {
        const mesh = new THREE.Mesh(boltGeo, mat);
        const big = mat === plasmaMat;
        const M = this.M;
        mesh.scale.set((big ? 25 : 1.5) * M, (big ? 25 : 1.5) * M, (big ? 60 : 45) * M);
        this.group.add(mesh);
        this.bolts.push({ local, vel, life, damage, friendly, radius, mesh });
    }

    damagePlayer(amount: number) {
        const p = this.player;
        if (p.dead) return;
        p.sinceHit = 0;
        const absorbed = Math.min(p.shield, amount);
        p.shield -= absorbed;
        p.hull = Math.max(0, p.hull - (amount - absorbed));
        this.onPlayerHit?.();
        if (p.hull <= 0) {
            p.dead = true;
            this.onPlayerDeath?.();
        }
    }

    respawn() {
        const p = this.player;
        p.dead = false;
        p.hull = p.maxHull;
        p.shield = p.maxShield;
        p.score = Math.max(0, p.score - 200);
    }

    explode(local: THREE.Vector3, sizeKm: number, color: number) {
        const n = 90;
        const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const d = new THREE.Vector3().randomDirection().multiplyScalar(sizeKm * (0.4 + Math.random()));
            vel.set([d.x, d.y, d.z], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({
            color: new THREE.Color(color).multiplyScalar(4), size: 4, sizeAttenuation: false,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const points = new THREE.Points(g, m);
        points.frustumCulled = false;
        this.group.add(points);
        this.bursts.push({ points, local: local.clone(), vel, offs: pos, life: 1.4, maxLife: 1.4 });
    }

    update(dt: number, shipWorld: THREE.Vector3, shipVelKmS: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
        this.time += dt;
        this.fireCooldown -= dt;
        const p = this.player;
        p.sinceHit += dt;
        if (!p.dead && p.sinceHit > 3) p.shield = Math.min(p.maxShield, p.shield + 10 * dt);
        if (!this.anchor) return;
        const me = this.toLocal(shipWorld)!;

        for (const e of this.enemies) this.think(e, dt, me, shipVelKmS);

        // Projectiles: swept-sphere hits so fast bolts cannot tunnel through a target.
        const prev = new THREE.Vector3();
        for (const b of this.bolts) {
            prev.copy(b.local);
            b.local.addScaledVector(b.vel, dt);
            b.life -= dt;
            if (b.friendly) {
                for (const e of this.enemies) {
                    if (e.hp > 0 && segmentHits(prev, b.local, e.local, e.def.hitKm + b.radius)) {
                        e.hp -= b.damage;
                        b.life = 0;
                        this.onHit?.();
                        this.explode(b.local, 0.05, 0x88ddff);
                        break;
                    }
                }
                if (b.life > 0 && this.extraTargets) {
                    for (const t of this.extraTargets()) {
                        if (segmentHits(prev, b.local, t.local, t.radiusKm + b.radius)) {
                            b.life = 0;
                            this.onHit?.();
                            if (t.hit(b.damage)) p.score += 10;
                            else this.explode(b.local, 0.03, 0xffcc88);
                            break;
                        }
                    }
                }
            } else if (!p.dead && segmentHits(prev, b.local, me, PLAYER_HIT_KM + b.radius)) {
                this.damagePlayer(b.damage);
                b.life = 0;
            }
            this.toWorld(b.local, b.mesh.position);
            b.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), b.vel, new THREE.Vector3(0, 1, 0)));
        }
        this.bolts = this.bolts.filter(b => {
            if (b.life > 0) return true;
            this.group.remove(b.mesh);
            return false;
        });

        // Deaths.
        this.enemies = this.enemies.filter(e => {
            if (e.hp > 0) return true;
            this.explode(e.local, e.kind === 'leviathan' ? 1.2 : 0.3, e.kind === 'crystal' ? 0x66ffff : 0xffaa44);
            p.score += e.def.score;
            this.removeEnemy(e);
            this.onKill?.(e.kind);
            return false;
        });

        for (const s of this.bursts) {
            s.life -= dt;
            const t = s.maxLife - s.life;
            for (let i = 0; i < s.vel.length; i++) s.offs[i] = s.vel[i] * t;
            s.points.position.copy(this.toWorld(s.local));
            s.points.scale.setScalar(this.KM);
            (s.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
            (s.points.material as THREE.PointsMaterial).opacity = Math.max(0, s.life / s.maxLife);
        }
        this.bursts = this.bursts.filter(s => {
            if (s.life > 0) return true;
            this.group.remove(s.points);
            s.points.geometry.dispose();
            (s.points.material as THREE.Material).dispose();
            return false;
        });

        this.updateLabels(camera, width, height, me);
    }

    private think(e: Enemy, dt: number, me: THREE.Vector3, meVel: THREE.Vector3) {
        const def = e.def;
        const to = this.v.subVectors(me, e.local);
        const d = to.length();
        const dir = to.clone().divideScalar(Math.max(d, 1e-6));
        const want = new THREE.Vector3();
        const p = this.player;
        if (p.dead) {
            want.copy(dir).multiplyScalar(-def.speed * 0.3);
        } else if (e.kind === 'crystal') {
            want.copy(dir).multiplyScalar(def.speed); // kamikaze
        } else if (e.kind === 'fighter') {
            // Attack runs: dive in, fire, break away, come round again.
            if (e.breakTimer > 0) {
                e.breakTimer -= dt;
                want.copy(dir).cross(new THREE.Vector3(0, 1, 0)).normalize().addScaledVector(dir, -0.6).setLength(def.speed);
            } else {
                want.copy(dir).multiplyScalar(def.speed);
                if (d < def.preferKm) e.breakTimer = 2.5;
            }
        } else {
            // Keep station at a preferred range and circle.
            const radial = THREE.MathUtils.clamp((d - def.preferKm) / def.preferKm, -1, 1);
            const tangent = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(Math.sin(e.phase), 1, Math.cos(e.phase))).normalize();
            want.copy(dir).multiplyScalar(radial).addScaledVector(tangent, 0.7).setLength(def.speed);
        }
        e.vel.lerp(want, 1 - Math.exp(-1.2 * dt));
        e.local.addScaledVector(e.vel, dt);
        if (this.ground) {
            const floor = this.ground(e.local.x, e.local.z) + def.hitKm + 0.05;
            if (e.local.y < floor) { e.local.y = floor; e.vel.y = Math.max(e.vel.y, 0); }
        }

        // Weapons: lead the target like a gunner would.
        e.cooldown -= dt;
        if (!p.dead && def.fireEvery > 0 && d < 14 && e.cooldown <= 0) {
            e.cooldown = def.fireEvery * (0.7 + Math.random() * 0.6);
            const t = d / def.boltSpeed;
            const aim = me.clone().addScaledVector(meVel, t).sub(e.local).normalize();
            aim.x += (Math.random() - 0.5) * 0.06; aim.y += (Math.random() - 0.5) * 0.06; aim.z += (Math.random() - 0.5) * 0.06;
            const vel = aim.normalize().multiplyScalar(def.boltSpeed).add(e.vel);
            const big = e.kind === 'leviathan';
            this.addBolt(e.local.clone().addScaledVector(aim, def.hitKm), vel, def.boltDamage, false, big ? 0.05 : 0.006,
                big ? plasmaMat : hostileMat, 3);
        }
        if (!p.dead && d < def.hitKm + PLAYER_HIT_KM + 0.02) {
            if (e.kind === 'crystal' || e.kind === 'drone' || e.kind === 'fighter') {
                this.damagePlayer(def.contactDamage);
                e.hp = 0; // rammed
            } else {
                this.damagePlayer(def.contactDamage * dt);
            }
        }

        // Pose and animation.
        this.toWorld(e.local, e.mesh.position);
        // Noses point along −Z; Matrix4.lookAt(0, face) turns −Z towards `face`.
        const face = e.kind === 'drone' || e.kind === 'leviathan' || e.vel.lengthSq() < 1e-6 ? to : e.vel;
        const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), face, new THREE.Vector3(0, 1, 0));
        e.mesh.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(look), 1 - Math.exp(-3 * dt));
        e.mesh.traverse(o => {
            if (o.name === 'spin') o.rotation.z += dt * 2;
            else if (o.name.startsWith('tentacle-')) {
                const [, t, s] = o.name.split('-').map(Number);
                o.rotation.x = Math.sin(this.time * 1.4 + t * 1.1 + s * 0.6) * 0.25;
                o.rotation.z = Math.cos(this.time * 1.1 + t * 0.7 + s * 0.5) * 0.15;
            }
        });
    }

    private updateLabels(camera: THREE.Camera, width: number, height: number, me: THREE.Vector3) {
        const v = new THREE.Vector3();
        for (const e of this.enemies) {
            const d = e.local.distanceTo(me);
            this.toWorld(e.local, v).project(camera);
            const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && d < 120;
            e.label.style.display = visible ? '' : 'none';
            // Off screen (or behind us): an arrow on the edge points the way.
            if (!visible && d < 120) {
                let x = v.x, y = v.y;
                if (v.z > 1) { x = -x; y = -y; }
                const k = 0.92 / Math.max(Math.abs(x), Math.abs(y), 1e-6);
                x *= k; y *= k;
                const px = (x * 0.5 + 0.5) * width, py = (-y * 0.5 + 0.5) * height;
                e.arrow.style.display = '';
                e.arrow.style.transform = `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px) rotate(${Math.atan2(-y, x)}rad)`;
                e.arrow.textContent = '➤';
                e.arrow.title = `${e.def.name}, ${d.toFixed(1)} км`;
            } else {
                e.arrow.style.display = 'none';
            }
            if (!visible) continue;
            e.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
            e.text.textContent = `${e.def.name} · ${d < 10 ? d.toFixed(1) : Math.round(d)} км`;
            e.bar.style.width = `${Math.max(0, (e.hp / e.def.hp) * 100)}%`;
        }
    }

    /** Positions of live enemies in the world, for markers and missions. */
    nearestEnemyKm(shipWorld: THREE.Vector3): number {
        const me = this.toLocal(shipWorld);
        if (!me) return Infinity;
        let best = Infinity;
        for (const e of this.enemies) best = Math.min(best, e.local.distanceTo(me));
        return best;
    }

    dispose() {
        this.clear();
        for (const s of this.bursts) this.group.remove(s.points);
        this.scene.remove(this.group);
        this.labelLayer.remove();
    }
}

/** Does the segment a→b pass within r of c? */
export function segmentHits(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number): boolean {
    const ab = new THREE.Vector3().subVectors(b, a);
    const len2 = ab.lengthSq();
    const t = len2 > 0 ? THREE.MathUtils.clamp(new THREE.Vector3().subVectors(c, a).dot(ab) / len2, 0, 1) : 0;
    return a.clone().addScaledVector(ab, t).distanceToSquared(c) <= r * r;
}
