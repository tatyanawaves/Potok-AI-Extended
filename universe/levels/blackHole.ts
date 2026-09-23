import * as THREE from 'three';
import { FLY_HELP, Navigator } from '../flight';
import { Action, blackbodyTexture, Level, LevelHost, ProximityTrigger, row } from '../common';
import { GalaxySpec } from '../mandelbrot';
import {
    fmtDistanceKm, fmtDuration, fmtNum, gravitationalTimeDilation, hawkingTemperatureK, horizonAreaM2, horizonAreaQuanta,
    lqgAreaGapM2, planckStarCoreRadiusM, schwarzschildRadiusKm, C_KM_S,
} from '../physics';
import { BLACKHOLE_FRAG, BLACKHOLE_VERT } from '../shaders';

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
    readonly help = `${FLY_HELP} · улетите дальше 150 rₛ — вернётесь в галактику · «Квантовое ядро» — что может быть вместо сингулярности`;
    private nav: Navigator;
    private leave = new ProximityTrigger(30);
    private material: THREE.ShaderMaterial;
    private time = 0;
    private core = 0;
    private coreTarget = 0;
    private doppler = true;

    constructor(private host: LevelHost, private galaxy: GalaxySpec) {
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
        this.scene.add(quad);

        this.camera.position.set(0, 2.2, 22);
        this.nav = new Navigator(this.camera, host.canvas, { speed: 2, minSpeed: 0.02, maxSpeed: 60 }, { min: 1.6, max: 140 });
        this.nav.orbit.enablePan = false;
        this.nav.orbit.autoRotateSpeed = 0.3;
        this.nav.setOrbit(new THREE.Vector3(), true);
    }

    actions(): Action[] {
        return [
            {
                label: '⚛ Квантовое ядро', title: 'Петлевая квантовая гравитация: вместо сингулярности — ядро из плоских квантов пространства',
                run: () => { this.coreTarget = this.coreTarget > 0 ? 0 : 1; }, active: () => this.coreTarget > 0,
            },
            {
                label: 'Эффект Доплера', title: 'Релятивистское усиление света со стороны, летящей к нам',
                run: () => { this.doppler = !this.doppler; }, active: () => this.doppler,
            },
            this.nav.mode === 'free'
                ? { label: '⟳ Облёт', run: () => this.nav.setOrbit(new THREE.Vector3(), true) }
                : { label: '✈ Свободный полёт', title: FLY_HELP, run: () => this.nav.setFree() },
            { label: 'Вид с ребра', run: () => this.view(0, 0.35, 20) },
            { label: 'Вид сверху', run: () => this.view(0, 24, 0.5) },
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

    private view(x: number, y: number, z: number) {
        this.camera.position.set(x, y, z);
        if (this.nav.mode === 'free') this.nav.lookAt(new THREE.Vector3());
    }

    resumed() {
        this.nav.setFree();
    }

    status(): string {
        const r = this.camera.position.length();
        return `r = ${r.toFixed(2)} rₛ · замедление времени ${(1 / Math.max(gravitationalTimeDilation(r), 1e-9)).toFixed(3)}× · ` +
            (r < 1.5 ? 'внутри фотонной сферы: любое направление кроме «наружу» ведёт в дыру' : r < 3 ? 'ближе устойчивой орбиты: без двигателей упадём' : 'устойчивая орбита возможна');
    }

    update(dt: number) {
        this.time += dt;
        this.nav.update(dt);
        // Free flight may not cross the horizon: nothing would come back out to show.
        if (this.camera.position.length() < 1.3) this.camera.position.setLength(1.3);
        if (this.nav.mode === 'free' && this.leave.check(dt, () => 180 - this.camera.position.length())) {
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
        this.scene.traverse(o => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
        });
        this.material.dispose();
    }
}
