import * as THREE from 'three';
import { ShipAvatar } from '../game/avatar';
import type { CameraState } from '../common';
import { FLY_HELP, Navigator } from '../flight';
import { Action, blackbodyTexture, Level, LevelHost, ProximityTrigger, row } from '../common';
import { GalaxySpec } from '../mandelbrot';
import {
    fmtDistanceKm, fmtDuration, fmtNum, gravitationalTimeDilation, hawkingTemperatureK, horizonAreaM2, horizonAreaQuanta,
    lqgAreaGapM2, planckStarCoreRadiusM, schwarzschildRadiusKm, tidalTearRadiusRs, C_KM_S,
} from '../physics';
import { BLACKHOLE_FRAG, BLACKHOLE_VERT } from '../shaders';
import { pilotState } from '../game/combat';

/**
 * The camera orbits in units of the Schwarzschild radius; the image is ray
 * traced per pixel in the fragment shader, so the scene is a single quad.
 */
export class BlackHoleLevel implements Level {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    readonly title: string;
    readonly bloom = { strength: 0.6, radius: 0.6, threshold: 0.7 };
    readonly maxPixelRatio = 1;
    readonly help = `${FLY_HELP} · дыра притягивает: у горизонта нужен форсаж (Shift), из-под горизонта не выбраться · улетите дальше 150 rₛ — вернётесь в галактику`;
    private nav: Navigator;
    private avatar: ShipAvatar;
    private leave = new ProximityTrigger(30);
    private material: THREE.ShaderMaterial;
    private time = 0;
    private core = 0;
    private coreTarget = 0;
    private doppler = true;
    /** Radius (in rₛ) where tides tear the ship apart. */
    private rTear: number;
    /** Past the event horizon: there is no way back out. */
    private inside = false;
    /** Seconds since the ship was torn apart, −1 while whole. */
    private torn = -1;

    constructor(private host: LevelHost, private galaxy: GalaxySpec) {
        this.rTear = tidalTearRadiusRs(galaxy.bhMassSun);
        this.title = galaxy.isMilkyWay ? 'Стрелец A*' : `Чёрная дыра ${galaxy.name}`;
        this.material = new THREE.ShaderMaterial({
            vertexShader: BLACKHOLE_VERT,
            fragmentShader: BLACKHOLE_FRAG,
            uniforms: {
                uRes: { value: new THREE.Vector2(1, 1) },
                uCamPos: { value: new THREE.Vector3() },
                uCamBasis: { value: new THREE.Matrix3() },
                uTanHalfFov: { value: Math.tan((this.camera.fov * Math.PI) / 360) },
                uTime: { value: 0 },
                uTmax: { value: 6500 },
                uRin: { value: 3 },   // innermost stable circular orbit, 3 r_s
                uRout: { value: 14 },
                uCore: { value: 0 },
                uCoreR: { value: 0.32 },
                uExposure: { value: 1 },
                uDoppler: { value: 1 },
                uLUT: { value: blackbodyTexture() },
            },
            depthTest: false,
            depthWrite: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        quad.frustumCulled = false;
        quad.renderOrder = -1; // the sky first: it has no depth, the ship draws over it
        this.scene.add(quad);

        this.camera.position.set(0, 2.2, 22);
        this.nav = new Navigator(this.camera, host.canvas, { speed: 2, minSpeed: 0.02, maxSpeed: 60 }, { min: 1.6, max: 140 });
        this.nav.orbit.enablePan = false;
        this.nav.orbit.autoRotateSpeed = 0.3;
        // Arrive at the controls, looking at the hole: fly in; «⟳ Облёт» for the slow tour.
        this.camera.lookAt(0, 0, 0);
        this.nav.setFree();
        this.avatar = new ShipAvatar(this.scene, this.camera, 0.35);
    }

    actions(): Action[] {
        const core: Action = {
            label: '⚛ Квантовое ядро', title: 'Петлевая квантовая гравитация: вместо сингулярности — ядро из плоских квантов пространства',
            run: () => { this.coreTarget = this.coreTarget > 0 ? 0 : 1; }, active: () => this.coreTarget > 0,
        };
        if (this.inside || this.torn >= 0) return [core]; // no tour from beneath the horizon
        return [
            {
                label: '⚛ Квантовое ядро', title: 'Петлевая квантовая гравитация: вместо сингулярности — ядро из плоских квантов пространства',
                run: () => { this.coreTarget = this.coreTarget > 0 ? 0 : 1; }, active: () => this.coreTarget > 0,
            },
            this.nav.mode === 'free'
                ? { label: '⟳ Облёт', run: () => this.nav.setOrbit(new THREE.Vector3(), true) }
                : { label: '✈ Свободный полёт', title: FLY_HELP, run: () => this.nav.setFree() },
        ];
    }

    info(): string {
        const M = this.galaxy.bhMassSun;
        const rsKm = schwarzschildRadiusKm(M);
        const r = this.camera.position.length();
        const rate = gravitationalTimeDilation(r);
        let html = row('Масса', `${fmtNum(M)} M☉`);
        html += row('Радиус Шварцшильда rₛ', fmtDistanceKm(rsKm));
        html += row('Фотонная сфера', `1,5 rₛ = ${fmtDistanceKm(1.5 * rsKm)}`);
        html += row('Внутренняя устойчивая орбита', `3 rₛ = ${fmtDistanceKm(3 * rsKm)}`);
        html += row('Мы на расстоянии', `${r.toFixed(2)} rₛ = ${fmtDistanceKm(r * rsKm)}`);
        html += row('Ход наших часов', `${(rate * 100).toFixed(2)} % от далёких`);
        html += row('Свет огибает rₛ за', fmtDuration((2 * Math.PI * rsKm) / C_KM_S));
        html += row('Температура Хокинга', `${fmtNum(hawkingTemperatureK(M))} K`);
        html += `<p>Каждый пиксель — луч света, проинтегрированный по геодезической Шварцшильда
        (u″ + u = 3⁄2 rₛu²). Отсюда кольцо фотонов и изображение задней части диска над и под тенью.
        Диск — по Шакуре–Сюняеву, T ∝ r<sup>−3/4</sup>; свет усилен как g⁴ (Доплер × гравитационное красное смещение).</p>`;
        html += `<h3>Квантовое ядро</h3>`;
        html += row('Площадь горизонта', `${fmtNum(horizonAreaM2(M))} м²`);
        html += row('Минимальный квант площади', `${fmtNum(lqgAreaGapM2())} м²`);
        html += row('Квантов на горизонте', fmtNum(horizonAreaQuanta(M)));
        html += row('Ядро «планковской звезды»', `${fmtNum(planckStarCoreRadiusM(M))} м`);
        html += `<p>В петлевой квантовой гравитации пространство — спиновая сеть: каждый узел — плоский квантовый
        многогранник, каждая связь со спином j несёт площадь 8πγℓ<sub>P</sub>²√(j(j+1)). Геометрия кусочно-плоская,
        а кривизна живёт на рёбрах, как в исчислении Редже. При планковской плотности коллапс сменяется отскоком —
        сингулярности нет. Грани ядра здесь — такие плоские кванты (цвет — спин), светящиеся швы — связи сети;
        горизонт разбит на кванты площади. Настоящий размер ядра — ${fmtNum(planckStarCoreRadiusM(M))} м, на экране он увеличен:
        это гипотеза, а не наблюдение.</p>`;
        return html;
    }

    saveState(): CameraState | null {
        if (this.inside || this.torn >= 0) return null; // no saving a doomed ship: it comes back from afar
        return { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() };
    }

    resumed() {
        if (this.camera.position.length() < 1.5) this.camera.position.setLength(22);
        this.nav.setFree();
    }

    status(): string {
        const r = this.camera.position.length();
        if (this.torn >= 0) return 'Корабль разорван приливными силами';
        const tide = Math.pow(this.rTear / r, 3);
        const tideText = tide > 0.01 ? ` · приливное растяжение ${Math.round(tide * 100)} % от предела прочности` : '';
        if (this.inside) return `r = ${r.toFixed(3)} rₛ · под горизонтом: все пути ведут к центру${tideText}`;
        return `r = ${r.toFixed(2)} rₛ · замедление времени ${(1 / Math.max(gravitationalTimeDilation(r), 1e-9)).toFixed(3)}× · ` +
            (r < 1.5 ? 'внутри фотонной сферы: удержаться можно только на форсаже' : r < 3 ? 'ближе устойчивой орбиты: без двигателей упадём' : 'устойчивая орбита возможна') + tideText;
    }

    /**
     * Gravity for the ship. Outside, a pull the engines must beat: to hover at r a ship needs
     * an acceleration that grows without limit at the horizon (GM/r²·(1 − rₛ/r)^−½), so close in
     * only the boost holds it. Inside the horizon every path leads to smaller r: steering can move
     * the ship sideways, never out, and it falls ever faster. Tides stretch it as (r_tear/r)³.
     */
    private gravity(dt: number, r0: number) {
        const pos = this.camera.position;
        if (this.torn >= 0) {
            pos.setLength(Math.max(pos.length() * Math.exp(-2 * dt), 1e-4));
            this.torn += dt;
            if (this.torn > 3) {
                this.torn = -2; // once
                pilotState.hull = pilotState.maxHull;
                pilotState.shield = pilotState.maxShield;
                this.host.toast('Корабль восстановлен у края галактики');
                this.host.back();
            }
            return;
        }
        let r = pos.length();
        if (!this.inside && r <= 1) {
            this.inside = true;
            this.host.toast('Вы пересекли горизонт событий — назад пути нет');
        }
        if (this.inside) {
            if (r > r0) pos.setLength(r0); // no direction points out
            r = pos.length();
            pos.setLength(r * Math.exp(-0.7 * dt) - 0.02 * dt);
        } else {
            const pull = Math.min(2 / (r * r * Math.sqrt(Math.max(1 - 1 / r, 1e-4))), 40);
            pos.setLength(Math.max(r - pull * dt, 0.5));
        }
        r = Math.max(pos.length(), 1e-4);
        const tide = Math.pow(this.rTear / r, 3);
        this.avatar.strain(1 + 2.5 * Math.sqrt(Math.min(tide, 1)));
        if (tide >= 1) {
            this.torn = 0;
            this.avatar.strain(3.5, true);
            pilotState.hull = 0;
            this.host.toast('Приливные силы разорвали корабль на части (спагеттификация)');
        }
    }

    update(dt: number) {
        this.time += dt;
        const r0 = this.camera.position.length();
        const v = this.torn >= 0 ? 0 : this.nav.update(dt);
        this.avatar.update(dt, this.nav.mode === 'free', Math.min(1, v / Math.max(this.nav.fly.speed, 1e-9)));
        if (this.nav.mode === 'free' && this.torn !== -2) this.gravity(dt, r0);
        if (this.nav.mode === 'free' && !this.inside && this.torn < 0 && this.leave.check(dt, () => 180 - this.camera.position.length())) {
            this.host.toast('Покидаем окрестности чёрной дыры');
            this.host.back();
        }
        this.core += (this.coreTarget - this.core) * (1 - Math.exp(-3 * dt));
        const u = this.material.uniforms;
        u.uTime.value = this.time;
        u.uCore.value = this.core;
        u.uDoppler.value = this.doppler ? 1 : 0;
        this.camera.updateMatrixWorld();
        u.uCamPos.value.copy(this.camera.position);
        u.uCamBasis.value.setFromMatrix4(this.camera.matrixWorld);
    }

    resize(w: number, h: number) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** The main loop sets the drawing-buffer size, which the shader needs in device pixels. */
    setBufferSize(w: number, h: number) {
        this.material.uniforms.uRes.value.set(w, h);
    }

    dispose() {
        this.nav.dispose();
        this.avatar.dispose();
        this.scene.traverse(o => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
        });
        this.material.dispose();
    }
}
