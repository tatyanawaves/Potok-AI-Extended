// Procedural meshes for the ship and its enemies. Sizes are in metres; the
// caller scales them into scene units.

import * as THREE from 'three';
import { DEFAULT_LOOK, ShipLook } from './progress';

export type EnemyKind = 'drone' | 'fighter' | 'crystal' | 'leviathan' | 'interceptor' | 'gunship' | 'hive';

const glow = (color: number, intensity = 1.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });

function hull(color: number, metal = 0.8, rough = 0.35) {
    return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
}

/**
 * The player's ship, nose along −Z like a camera, in the pilot's chosen look: one of three
 * hulls (a 40 m interceptor, a delta wing, a heavy gunship) in their colours.
 */
export function makeShip(look: ShipLook = DEFAULT_LOOK): THREE.Group {
    const g = new THREE.Group();
    const hullCol = new THREE.Color(look.hull).getHex(), accent = new THREE.Color(look.accent).getHex();
    const skin = hull(hullCol, 0.75, 0.45), trim = hull(accent, 0.7, 0.5);
    const heavy = look.variant === 'heavy', delta = look.variant === 'delta';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 4.5 : 3, heavy ? 6.5 : 5, heavy ? 30 : 26, 16), skin);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(heavy ? 4.5 : 3, delta ? 18 : 14, 16), skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = heavy ? -22 : delta ? -22 : -20;
    g.add(nose);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2a5a80, metalness: 0.3, roughness: 0.08, emissive: 0x04121e }));
    canopy.position.set(0, heavy ? 3.8 : 2.6, -9);
    canopy.scale.set(1, 0.7, 1.8);
    g.add(canopy);
    // Wings: straight and short, a broad delta, or stubby with extra engine pods.
    const wingShape = delta
        ? new THREE.Shape([new THREE.Vector2(0, -14), new THREE.Vector2(22, 12), new THREE.Vector2(20, 15), new THREE.Vector2(0, 13)])
        : heavy
            ? new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(14, 4), new THREE.Vector2(14, 12), new THREE.Vector2(0, 12)])
            : new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(18, 8), new THREE.Vector2(18, 13), new THREE.Vector2(0, 11)]);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.8, bevelEnabled: false });
    const span = delta ? 23 : heavy ? 15 : 21;
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(1.8), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const side of [1, -1]) {
        const w = new THREE.Mesh(wingGeo, trim);
        w.rotation.x = Math.PI / 2;
        w.scale.x = side;
        w.position.set(side * (heavy ? 4.5 : 3), 0, -2);
        g.add(w);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 5), glow(side > 0 ? 0x22ff66 : 0xff3322, 0.9));
        tip.position.set(side * span, 0, 9);
        g.add(tip);
        const pods = heavy ? [7, 12] : [7];
        for (const x of pods) {
            const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 9, 10), trim);
            pod.rotation.x = Math.PI / 2;
            pod.position.set(side * x, -1, 10);
            g.add(pod);
            const flame = new THREE.Mesh(new THREE.ConeGeometry(1.4, 8, 10, 1, true), flameMat);
            flame.rotation.x = Math.PI / 2;
            flame.position.set(side * x, -1, 18);
            flame.name = 'flame';
            g.add(flame);
        }
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, heavy ? 10 : 8, 8), trim);
    fin.position.set(0, heavy ? 6.5 : 5, 9);
    g.add(fin);
    // Wing guns. No muzzle flash: a glow on the hull read as the shot sitting on the ship.
    for (const side of [1, -1]) {
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), hull(0x3a3f48, 0.8, 0.4));
        gun.rotation.x = Math.PI / 2;
        gun.position.set(side * 9, -0.3, -4.5);
        g.add(gun);
    }
    return g;
}

/** A recon drone: an armoured octahedron in a spinning ring, with one red eye. Radius ≈ 60 m. */
function makeDrone(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(30, 0), hull(0x3a3f4a, 0.9, 0.3)));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(52, 4, 8, 32), hull(0x6b7280));
    ring.name = 'spin';
    g.add(ring);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), glow(0xff2020, 5));
    eye.position.z = -26;
    g.add(eye);
    return g;
}

/** A pirate fighter: a black wedge with orange engines. Length ≈ 90 m. */
function makeFighter(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(16, 90, 4), hull(0x24262b, 0.6, 0.5));
    body.rotation.x = -Math.PI / 2;
    body.scale.set(1.6, 0.5, 1);
    g.add(body);
    for (const side of [1, -1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(50, 3, 26), hull(0x5a1f1a, 0.5, 0.6));
        wing.position.set(side * 34, 0, 18);
        wing.rotation.y = side * 0.35;
        g.add(wing);
        const engine = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), glow(0xff8a20, 5));
        engine.position.set(side * 10, 0, 44);
        g.add(engine);
    }
    return g;
}

/** A crystalline swarm creature: a glowing icosahedral shard. Radius ≈ 40 m. */
function makeCrystal(): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x55e6ff, emissive: 0x1188aa, emissiveIntensity: 1.5, metalness: 0.1, roughness: 0.1, flatShading: true });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(28, 0), m);
    core.scale.set(1, 1.6, 1);
    core.name = 'spin';
    g.add(core);
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(10, 0), glow(0xaaffff, 4)));
    return g;
}

/**
 * A space leviathan: a 600 m bioluminescent body with six segmented
 * tentacles. The tentacle segments are named so the AI can make them sway.
 */
function makeLeviathan(): THREE.Group {
    const g = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(300, 48, 32);
    const pos = bodyGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = Math.sin(v.x * 0.02) * Math.sin(v.y * 0.025) * Math.sin(v.z * 0.018);
        v.multiplyScalar(1 + 0.12 * n);
        v.z *= 1.5; // elongated
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    bodyGeo.computeVertexNormals();
    const skin = new THREE.MeshStandardMaterial({ color: 0x2b1838, emissive: 0x401060, emissiveIntensity: 0.6, roughness: 0.7, metalness: 0.05 });
    g.add(new THREE.Mesh(bodyGeo, skin));
    for (let k = 0; k < 14; k++) {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(22 + (k % 3) * 8, 10, 8), glow(k % 2 ? 0x44ffcc : 0xcc44ff, 3));
        const a = k * 2.4, b = (k / 14) * Math.PI;
        spot.position.set(Math.cos(a) * Math.sin(b) * 290, Math.cos(b) * 290, Math.sin(a) * Math.sin(b) * 430);
        g.add(spot);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(90, 25, 12, 24), glow(0xff3366, 3));
    mouth.position.z = -440;
    g.add(mouth);
    const segGeo = new THREE.CylinderGeometry(22, 30, 120, 10);
    segGeo.translate(0, -60, 0);
    for (let t = 0; t < 6; t++) {
        let parent: THREE.Object3D = g;
        const root = new THREE.Object3D();
        const a = (t / 6) * Math.PI * 2;
        root.position.set(Math.cos(a) * 200, Math.sin(a) * 200, 380);
        root.rotation.set(Math.PI / 2 + Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
        g.add(root);
        parent = root;
        for (let s = 0; s < 7; s++) {
            const seg = new THREE.Mesh(segGeo, skin);
            seg.scale.setScalar(1 - s * 0.11);
            seg.name = `tentacle-${t}-${s}`;
            if (s > 0) seg.position.y = -120 * (1 - (s - 1) * 0.11);
            parent.add(seg);
            parent = seg;
        }
    }
    return g;
}

/** An interceptor: a slim violet dart with forward-swept blades and a hot blue drive. Length ≈ 60 m. */
function makeInterceptor(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(7, 60, 6), hull(0x3b2a55, 0.7, 0.35));
    body.rotation.x = -Math.PI / 2;
    g.add(body);
    for (const side of [1, -1]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(34, 1.5, 10), hull(0x6a4a9a, 0.6, 0.4));
        blade.position.set(side * 18, 0, 8);
        blade.rotation.y = -side * 0.5;
        g.add(blade);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), glow(0xff44cc, 4));
        tip.position.set(side * 32, 0, -2);
        g.add(tip);
    }
    const drive = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), glow(0x55aaff, 5));
    drive.position.z = 30;
    drive.scale.set(1, 1, 1.8);
    g.add(drive);
    return g;
}

/** A gunship: a heavy armoured hull with two turrets and rows of orange lights. Length ≈ 150 m. */
function makeGunship(): THREE.Group {
    const g = new THREE.Group();
    const armour = hull(0x3a3d42, 0.85, 0.5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(50, 26, 140), armour);
    g.add(body);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 30), armour);
    bridge.position.set(0, 18, 30);
    g.add(bridge);
    for (const z of [-40, 10]) {
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 8, 12), hull(0x55585e));
        turret.position.set(0, 17, z);
        g.add(turret);
        for (const x of [-3, 3]) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 26, 6), hull(0x2a2c30));
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(x, 19, z - 14);
            g.add(barrel);
        }
    }
    for (let k = 0; k < 8; k++) {
        for (const side of [1, -1]) {
            const light = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 6), glow(0xff8a20, 4));
            light.position.set(side * 25.5, 2, -55 + k * 15);
            g.add(light);
        }
    }
    for (const x of [-15, 15]) {
        const engine = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), glow(0xff5520, 4));
        engine.position.set(x, 0, 72);
        g.add(engine);
    }
    return g;
}

/** A hive: a ribbed organic pod with glowing pores, slowly breathing; drones hatch from it. Radius ≈ 150 m. */
function makeHive(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(110, 40, 28);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const rib = 1 + 0.12 * Math.sin(Math.atan2(v.z, v.x) * 9) * Math.cos(v.y * 0.02);
        v.multiplyScalar(rib);
        v.y *= 1.3;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: 0x1a2a08, roughness: 0.8, metalness: 0.1 }));
    body.name = 'pulse';
    g.add(body);
    for (let k = 0; k < 22; k++) {
        const pore = new THREE.Mesh(new THREE.SphereGeometry(9 + (k % 3) * 4, 10, 8), glow(0x9dff7a, 3));
        const a = k * 2.4, b = ((k + 0.5) / 22) * Math.PI;
        pore.position.set(Math.cos(a) * Math.sin(b) * 118, Math.cos(b) * 150, Math.sin(a) * Math.sin(b) * 118);
        g.add(pore);
    }
    return g;
}

export function makeEnemy(kind: EnemyKind): THREE.Group {
    const g = kind === 'drone' ? makeDrone() : kind === 'fighter' ? makeFighter() : kind === 'crystal' ? makeCrystal()
        : kind === 'interceptor' ? makeInterceptor() : kind === 'gunship' ? makeGunship() : kind === 'hive' ? makeHive() : makeLeviathan();
    // A faint red self-glow keeps the silhouette readable on the night side, against black space.
    g.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.isMeshStandardMaterial && m.emissive && m.emissive.getHex() === 0) m.emissive.setRGB(0.12, 0.03, 0.03);
    });
    return g;
}
