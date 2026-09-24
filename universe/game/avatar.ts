// The pilot's ship on the map-scale levels (the cosmic web, a galaxy, near a
// black hole), where there is no combat: the same ship, in the pilot's look,
// flying just ahead of the camera, banking into turns, flame following thrust.

import * as THREE from 'three';
import { makeShip } from './models';
import { progress } from './progress';

export class ShipAvatar {
    private ship: THREE.Group;
    private rig = new THREE.Group();
    private key = new THREE.DirectionalLight(0xffffff, 2.4);
    private fill = new THREE.HemisphereLight(0x8090b0, 0x201810, 0.9);
    private lastQ = new THREE.Quaternion();
    private bank = 0;
    private time = 0;
    private off: () => void;

    /**
     * `size` is the scene length that stands for the ship's 40 m, and sets how far ahead of
     * the camera it flies; keep it well beyond the camera's near plane. `light` scales the ship's
     * lighting: dim it where the sky already glows (galaxies, the web).
     */
    constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private size: number, light = 1) {
        this.key.intensity *= light;
        this.fill.intensity *= light;
        // The camera carries the ship (and its lights) as children, so it has to be in the scene.
        if (!camera.parent) scene.add(camera);
        this.ship = this.build();
        this.rig.add(this.ship);
        this.rig.position.set(0, -size * 0.34, -size * 2.2);
        this.key.position.set(-1, 2, 1);
        camera.add(this.rig, this.key, this.fill);
        this.lastQ.copy(camera.quaternion);
        this.off = progress.onChange(() => this.restyle());
    }

    private build(): THREE.Group {
        const g = makeShip(progress.data.look);
        g.scale.setScalar(this.size / 40);
        return g;
    }

    private restyle() {
        this.rig.remove(this.ship);
        this.ship.traverse(o => (o as THREE.Mesh).geometry?.dispose());
        this.ship = this.build();
        this.rig.add(this.ship);
    }

    /** `thrust` 0…1 lengthens the flame; hidden when the camera is not the pilot's (an orbit view). */
    update(dt: number, visible: boolean, thrust: number) {
        this.time += dt;
        this.rig.visible = visible;
        if (!visible) { this.lastQ.copy(this.camera.quaternion); return; }
        // Yaw rate from how the camera turned this frame: bank into it.
        const d = this.lastQ.clone().invert().multiply(this.camera.quaternion);
        const yaw = new THREE.Euler().setFromQuaternion(d, 'YXZ').y / Math.max(dt, 1e-4);
        this.lastQ.copy(this.camera.quaternion);
        this.bank += (THREE.MathUtils.clamp(yaw * 0.9, -0.9, 0.9) - this.bank) * (1 - Math.exp(-5 * dt));
        this.rig.rotation.set(0.05 + Math.sin(this.time * 1.3) * 0.02, 0, this.bank);
        this.rig.position.y = -this.size * 0.34 + Math.sin(this.time * 1.7) * this.size * 0.01;
        const flicker = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 31);
        this.ship.traverse(o => { if (o.name === 'flame') o.scale.set(1, (0.25 + thrust * 1.6) * flicker, 1); });
    }

    dispose() {
        this.off();
        this.camera.remove(this.rig, this.key, this.fill);
        this.ship.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    }
}
