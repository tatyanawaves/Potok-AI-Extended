// Creatures that live between the planets and can be talked to: a void
// jellyfish, a star whale, a crystal oracle, a firefly swarm-mind and a
// scrap-hermit. Meshes are built in kilometres and scaled into the scene.

import * as THREE from 'three';
import { Labels } from '../common';
import { mulberry32 } from '../mandelbrot';
import { ACCEPT, Conversation, CreatureMind, DECLINE, describeAccess, DialogueTurn, QuestOffer, WorldBrief } from './dialogue';

export type Species = 'medusa' | 'whale' | 'oracle' | 'swarm' | 'scavenger';

export interface CreatureSpec extends CreatureMind {
    id: string;
    kind: Species;
    color: number;
    emoji: string;
    /** Height above the home body's surface, in its radii. */
    altitude: number;
    /** Where round the body it hangs, radians. */
    angle: number;
}

/** Talking range, km. */
export const TALK_KM = 250;
/** Creatures are drawn at this many km per model unit: a medusa's bell is ~8 km across, a whale ~30 km long. */
const SIZE_KM = 5;

type Template = Omit<CreatureSpec, 'home' | 'wish'> & { wish: Omit<CreatureSpec['wish'], 'body'> & { body?: string } };

const TEMPLATES: Template[] = [
    {
        id: 'oira', kind: 'medusa', color: 0x88c8ff, emoji: '🪼', altitude: 2.2, angle: 0.8,
        name: 'Ойра', species: 'медуза пустоты, древняя, как пояс астероидов',
        persona: 'говорит медленно и поэтично, светится, когда волнуется; питается солнечным ветром; зовёт пилота «маленький огонёк»',
        script: {
            greet: 'Маленький огонёк… ты летишь так быстро. Остановись, послушай, как поёт солнечный ветер.',
            lore: [
                'Я пью свет вашей звезды уже миллион оборотов. Мои щупальца помнят времена, когда ваша Луна была ближе.',
                'Мы, медузы, не умираем — мы растворяемся в свете и собираемся снова, когда звезда зовёт.',
            ],
            trouble: 'Но теперь пришли холодные машины. Их глаза-дроны режут мою стаю лучами, чтобы измерить.',
        },
        wish: { type: 'kill', enemy: 'drone', count: 4, title: 'Тишина для стаи', reward: 450, why: 'Уничтожь дронов, что кружат над моим домом, и стая снова запоёт.' },
    },
    {
        id: 'thal', kind: 'whale', color: 0x5fe0c0, emoji: '🐋', altitude: 3.5, angle: 2.4,
        name: 'Великий Тхал', species: 'звёздный кит, длиной в шесть километров',
        persona: 'добродушный гигант, говорит низко и неторопливо, иногда напевает; тоскует по родичам, которых преследует левиафан',
        script: {
            greet: 'Мммм… Крошечный кораблик. Не бойся, я ем только пыль комет. Как тебя зовут, звёздный малёк?',
            lore: [
                'Мои песни слышно на три световых минуты. Когда-то мне отвечали десятки голосов.',
                'Мы плывём по течениям гравитации, от планеты к планете, и храним в памяти карты всех орбит.',
            ],
            trouble: 'Теперь отвечает только тишина. Левиафан пришёл из тёмного края системы и глотает моих родичей.',
        },
        wish: { type: 'kill', enemy: 'leviathan', count: 1, title: 'Песня Тхала', reward: 1500, why: 'Прогони левиафана — убей его, и я спою тебе песню, которую не слышал ни один человек.' },
    },
    {
        id: 'kepler0', kind: 'oracle', color: 0xc8a0ff, emoji: '🔮', altitude: 2.8, angle: 4.1,
        name: 'Оракул Кеплер-Ноль', species: 'кристаллический разум',
        persona: 'говорит загадками и числами, одержим эллипсами, множеством Мандельброта и третьим законом Кеплера; холодно-вежлив',
        script: {
            greet: 'Квадрат периода твоего полёта пропорционален кубу твоего любопытства. Приветствую, пилот.',
            lore: [
                'Я — решение уравнения z → z² + c, которое не ушло в бесконечность. Я осталось. Я думаю.',
                'Каждая орбита — эллипс, каждый эллипс — обещание вернуться. Я считаю обещания этой системы.',
            ],
            trouble: 'Но одна орбита сбилась. Где-то вдали что-то исказило мои вычисления, и я не вижу, что именно.',
        },
        wish: { type: 'reach', title: 'Проверка эллипса', reward: 500, why: 'Долети до дальнего мира, что я назову, и вернись с наблюдениями — твой путь исправит мои расчёты.' },
    },
    {
        id: 'vivi', kind: 'swarm', color: 0xffd166, emoji: '✨', altitude: 1.8, angle: 5.5,
        name: 'Рой Ви-Ви', species: 'коллективный разум светлячков-плазмоидов',
        persona: 'говорят хором, о себе — «мы», перебивают сами себя, игривые, любопытные, обожают блестящее',
        script: {
            greet: 'Мы видим тебя! Мы видим! Блестящий кораблик — можно мы посидим на твоих крыльях? Нет? Жаль!',
            lore: [
                'Нас восемьсот сорок два — нет, сорок три, Ви-Ви-младший только родился из искры.',
                'Мы танцуем в магнитных полях и рисуем узоры. Одни узоры — это слова, другие — просто красиво!',
            ],
            trouble: 'Но злые острые кристаллиды таранят наш танец! Они не умеют танцевать, они только бьются!',
        },
        wish: { type: 'kill', enemy: 'crystal', count: 8, title: 'Танец без таранов', reward: 550, why: 'Разбей кристаллидов, пожалуйста-пожалуйста, и мы нарисуем в небе твоё имя!' },
    },
    {
        id: 'skrip', kind: 'scavenger', color: 0xff9a5a, emoji: '🦀', altitude: 1.5, angle: 3.2,
        name: 'Скрипун', species: 'механический краб-отшельник, живущий в обломках спутников',
        persona: 'ворчливый, торгуется за каждую гайку, обожает металлолом, называет пилота «жестянкой»; честный, если ему заплатить',
        script: {
            greet: 'Эй, жестянка! Не подлетай так близко, поцарапаешь мою раковину. Это, между прочим, корпус спутника связи.',
            lore: [
                'Сорок лет собираю ваш мусор. Спутники, болты, панели — всё сгодится. Вы, люди, щедро сорите на орбитах.',
                'Моя клешня — из манипулятора старой станции. Работает лучше, чем у вас, между прочим.',
            ],
            trouble: 'А тут пираты повадились. Налетают на штурмовиках и обчищают мои склады. Мои!',
        },
        wish: { type: 'kill', enemy: 'fighter', count: 3, title: 'Склады Скрипуна', reward: 700, why: 'Сбей пиратские штурмовики у моих складов — заплачу, честно, гайкой к гайке.' },
    },
];

function fromTemplate(t: Template, home: string, far: string): CreatureSpec {
    return { ...t, home, wish: { ...t.wish, body: t.wish.body ?? (t.wish.type === 'reach' ? far : home) } as CreatureSpec['wish'] };
}

/** The Solar System's residents. */
export function solarCreatures(): CreatureSpec[] {
    const [oira, thal, oracle, vivi, skrip] = TEMPLATES;
    return [
        fromTemplate(oira, 'Луна', 'Нептун'),
        fromTemplate(skrip, 'Земля', 'Нептун'),
        fromTemplate(vivi, 'Венера', 'Нептун'),
        fromTemplate(oracle, 'Европа', 'Нептун'),
        fromTemplate(thal, 'Титан', 'Нептун'),
    ];
}

/** A few creatures spread over a generated system's planets. */
export function generatedCreatures(planets: string[], seed: number): CreatureSpec[] {
    if (!planets.length) return [];
    const rng = mulberry32(seed ^ 0xc4ea);
    const pool = [...TEMPLATES].sort(() => rng() - 0.5).slice(0, Math.min(3, planets.length + 1));
    const far = planets[planets.length - 1];
    return pool.map((t, i) => fromTemplate(t, planets[Math.min(planets.length - 1, Math.floor(rng() * planets.length) + (i === 0 ? 0 : 0))], far));
}

// ---------------------------------------------------------------------------
// Meshes (km)
// ---------------------------------------------------------------------------

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}`;

const GLOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uPulse;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
    #include <logdepthbuf_fragment>
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    // Veins of light running over the membrane.
    float veins = 0.5 + 0.5 * sin(atan(vObj.z, vObj.x) * 12.0 + vObj.y * 6.0 - uTime * 1.5);
    float pulse = 0.75 + 0.25 * sin(uTime * uPulse);
    vec3 c = uColor * (0.12 + rim * 1.6 + veins * 0.18) * pulse;
    gl_FragColor = vec4(c, 0.35 + rim * 0.6);
}`;

function glowMaterial(color: number, pulse = 1.6) {
    return new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.4) }, uTime: { value: 0 }, uPulse: { value: pulse } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
}
const light = (color: number, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

interface Animated { group: THREE.Group; tick: (t: number) => void; materials: THREE.ShaderMaterial[] }

function makeMedusa(color: number): Animated {
    const g = new THREE.Group();
    const bellMat = glowMaterial(color, 1.3);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(1.6, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat);
    g.add(bell);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), light(color, 2.5)));
    const tentacles: THREE.Line[] = [];
    const N = 14, P = 28;
    for (let i = 0; i < N; i++) {
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        line.frustumCulled = false;
        tentacles.push(line);
        g.add(line);
    }
    return {
        group: g, materials: [bellMat],
        tick: t => {
            // The bell contracts and relaxes; the tentacles trail in a slow wave.
            const beat = Math.sin(t * 1.3);
            bell.scale.set(1 + 0.08 * beat, 1 - 0.1 * beat, 1 + 0.08 * beat);
            tentacles.forEach((line, i) => {
                const a = (i / N) * Math.PI * 2, r0 = 1.2 + 0.2 * Math.sin(i * 2.3);
                const pos = line.geometry.attributes.position as THREE.BufferAttribute;
                for (let k = 0; k < P; k++) {
                    const s = k / (P - 1);
                    const sway = Math.sin(t * 1.1 + i * 0.7 - s * 5) * 0.5 * s;
                    pos.setXYZ(k, Math.cos(a) * (r0 * (1 - 0.5 * s)) + sway, -s * (5 + (i % 3)), Math.sin(a) * (r0 * (1 - 0.5 * s)) + Math.cos(t * 0.9 + i - s * 4) * 0.4 * s);
                }
                pos.needsUpdate = true;
            });
        },
    };
}

function makeWhale(color: number): Animated {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x1d3140, emissive: new THREE.Color(color).multiplyScalar(0.12), roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), skin);
    body.scale.set(1.1, 0.9, 3.2);
    g.add(body);
    const tail = new THREE.Group();
    tail.position.z = 3.1;
    const fluke = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.9), skin);
    fluke.position.z = 0.6;
    tail.add(fluke);
    g.add(tail);
    const fins: THREE.Mesh[] = [];
    for (const side of [1, -1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.7), skin);
        fin.position.set(side * 1.4, -0.3, -0.8);
        fins.push(fin);
        g.add(fin);
    }
    const spotMat = light(color, 2.2);
    for (let k = 0; k < 18; k++) {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(0.07 + (k % 3) * 0.03, 8, 6), spotMat);
        const z = -2.6 + (k / 17) * 5.2, side = k % 2 ? 1 : -1;
        const r = Math.sqrt(Math.max(0, 1 - (z / 3.2) ** 2));
        spot.position.set(side * r * 1.05, r * 0.3, z);
        g.add(spot);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), light(0xffffff, 2));
    eye.position.set(0.7, 0.2, -2.4);
    g.add(eye);
    return {
        group: g, materials: [],
        tick: t => {
            tail.rotation.x = Math.sin(t * 0.9) * 0.35;
            fins.forEach((f, i) => { f.rotation.z = (i ? -1 : 1) * Math.sin(t * 0.9 + 0.8) * 0.25; });
            g.rotation.z = Math.sin(t * 0.3) * 0.08;
        },
    };
}

function makeOracle(color: number): Animated {
    const g = new THREE.Group();
    const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({
        color, emissive: new THREE.Color(color).multiplyScalar(0.35), metalness: 0.2, roughness: 0.05, flatShading: true, transparent: true, opacity: 0.9,
    }));
    crystal.scale.set(1, 1.7, 1);
    g.add(crystal);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), light(0xffffff, 3)));
    const rings: THREE.Mesh[] = [];
    [2.2, 2.7, 3.2].forEach((r, i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 8, 96), light(color, 2 - i * 0.4));
        ring.rotation.set(i * 0.9, i * 1.3, 0);
        rings.push(ring);
        g.add(ring);
    });
    const halo = glowMaterial(color, 0.7);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(2, 32, 16), halo));
    return {
        group: g, materials: [halo],
        tick: t => {
            crystal.rotation.y = t * 0.2;
            rings.forEach((r, i) => { r.rotation.x += 0.004 * (i + 1); r.rotation.y += 0.003 * (3 - i); });
        },
    };
}

function makeSwarm(color: number): Animated {
    const g = new THREE.Group();
    const N = 420;
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: new THREE.Color(color).multiplyScalar(3), size: 3, sizeAttenuation: false,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    pts.frustumCulled = false;
    g.add(pts);
    const seeds = Array.from({ length: N }, (_, i) => [Math.sin(i * 12.9898) * 43758.5453 % 1, Math.sin(i * 78.233) * 12345.678 % 1, (i * 0.618) % 1]);
    return {
        group: g, materials: [],
        tick: t => {
            const pos = geo.attributes.position as THREE.BufferAttribute;
            // Fireflies on Lissajous loops round a slowly turning heart.
            for (let i = 0; i < N; i++) {
                const [a, b, c] = seeds[i];
                const w = 0.3 + Math.abs(a) * 0.6, r = 1 + 2.2 * Math.abs(b);
                pos.setXYZ(i, Math.sin(t * w + i) * r, Math.sin(t * w * 1.3 + c * 6.28) * r * 0.6, Math.cos(t * w * 0.7 + i * 0.5) * r);
            }
            pos.needsUpdate = true;
        },
    };
}

function makeScavenger(color: number): Animated {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x7a6a58, metalness: 0.8, roughness: 0.4, emissive: 0x100804 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.6), metal);
    g.add(shell);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.35), metal);
    dish.position.set(0, 0.5, 0.2);
    g.add(dish);
    const legs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6).translate(0, -0.8, 0), metal);
        leg.position.set((i % 2 ? 1 : -1) * 1.0, -0.3, -0.6 + Math.floor(i / 2) * 0.6);
        leg.rotation.z = (i % 2 ? 1 : -1) * 0.9;
        legs.push(leg);
        g.add(leg);
    }
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.4).translate(0, 0, -0.7), metal);
    claw.position.set(0.7, 0, -0.8);
    g.add(claw);
    for (const x of [-0.35, 0.35]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), light(color, 3));
        eye.position.set(x, 0.3, -0.85);
        g.add(eye);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), light(0xff3030, 4));
    beacon.position.set(0, 1.4, 0.2);
    g.add(beacon);
    // Scrap it keeps in orbit round itself.
    const scrap: THREE.Mesh[] = [];
    for (let k = 0; k < 7; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3 + (k % 3) * 0.2, 0.05, 0.5), metal);
        scrap.push(s);
        g.add(s);
    }
    return {
        group: g, materials: [],
        tick: t => {
            legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2 + i) * 0.25; });
            claw.rotation.y = Math.sin(t * 0.7) * 0.4;
            beacon.visible = Math.sin(t * 4) > 0;
            scrap.forEach((s, k) => {
                const a = t * (0.2 + k * 0.03) + k;
                s.position.set(Math.cos(a) * (2.4 + k * 0.2), Math.sin(a * 1.3) * 0.6, Math.sin(a) * (2.4 + k * 0.2));
                s.rotation.set(a, a * 0.7, 0);
            });
        },
    };
}

const BUILDERS: Record<Species, (color: number) => Animated> = {
    medusa: makeMedusa, whale: makeWhale, oracle: makeOracle, swarm: makeSwarm, scavenger: makeScavenger,
};

// ---------------------------------------------------------------------------
// The residents of a system
// ---------------------------------------------------------------------------

interface BodyLike { name: string; pos: THREE.Vector3; radius: number }

interface Creature {
    spec: CreatureSpec;
    body: Animated;
    beacon: THREE.Points;
    label: import('../common').Label;
    pos: THREE.Vector3;
    present: boolean;
    /** The errand it gave, while that is still open. */
    questId?: string;
    greeted: boolean;
}

export class Creatures {
    private list: Creature[] = [];
    private labels: Labels;

    constructor(private scene: THREE.Scene, layer: HTMLElement, specs: CreatureSpec[], private KM: number) {
        this.labels = new Labels(layer);
        for (const spec of specs) {
            const body = BUILDERS[spec.kind](spec.color);
            body.group.scale.setScalar(KM * SIZE_KM);
            scene.add(body.group);
            // A beacon a few pixels wide, so the creature can be found from afar.
            const beacon = new THREE.Points(
                new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
                new THREE.PointsMaterial({ color: new THREE.Color(spec.color).multiplyScalar(2.5), size: 7, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
            );
            beacon.frustumCulled = false;
            scene.add(beacon);
            const label = this.labels.add(`${spec.emoji} ${spec.name}`, 'creature');
            this.list.push({ spec, body, beacon, label, pos: new THREE.Vector3(), present: false, greeted: false });
        }
    }

    get all(): readonly Creature[] { return this.list; }

    /** Where everyone is this frame, riding with their home worlds. */
    place(time: number, bodyByName: (n: string) => BodyLike | undefined) {
        for (const c of this.list) {
            const home = bodyByName(c.spec.home);
            c.present = !!home;
            if (!home) continue;
            // Drifting round the home world at a stroll (0.3 km/s), so a pilot beside it stays beside it.
            const orbitKm = (home.radius * (1 + c.spec.altitude)) / this.KM;
            const a = c.spec.angle + (time * 0.3) / orbitKm;
            const dir = new THREE.Vector3(Math.cos(a), 0.25 * Math.sin(a * 3), Math.sin(a)).normalize();
            c.pos.copy(home.pos).addScaledVector(dir, home.radius * (1 + c.spec.altitude));
            c.pos.y += Math.sin(time * 0.2 + c.spec.angle) * 2 * this.KM; // a slow bob
        }
    }

    /** Animate everyone (placed by place()); returns the nearest creature within talking range. */
    update(time: number, pilot: THREE.Vector3, camera: THREE.Camera, w: number, h: number): { c: Creature; km: number } | null {
        let near: { c: Creature; km: number } | null = null;
        for (const c of this.list) {
            c.body.group.visible = c.present;
            if (!c.present) { c.beacon.visible = c.label.visible = false; continue; }
            // Named and marked only within a few million km, not across the whole system.
            c.beacon.visible = c.label.visible = c.pos.distanceTo(pilot) / this.KM < 4e6;
            c.body.group.position.copy(c.pos);
            c.beacon.position.copy(c.pos);
            // Face the pilot, lazily.
            const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(c.pos, pilot, new THREE.Vector3(0, 1, 0)));
            c.body.group.quaternion.slerp(want, 0.01);
            c.body.tick(time);
            for (const m of c.body.materials) m.uniforms.uTime.value = time;
            c.label.position.copy(c.pos);
            const km = c.pos.distanceTo(pilot) / this.KM;
            c.label.el.dataset.near = km < TALK_KM ? '1' : '';
            // The beacon fades as the creature itself becomes visible.
            (c.beacon.material as THREE.PointsMaterial).opacity = Math.min(0.9, km / 400);
            if (km < TALK_KM && (!near || km < near.km)) near = { c, km };
        }
        this.labels.update(camera, w, h);
        return near;
    }

    /** Distance to the nearest creature, km (for easing the ship in). */
    nearestKm(pilot: THREE.Vector3): number {
        let best = Infinity;
        for (const c of this.list) if (c.present) best = Math.min(best, c.pos.distanceTo(pilot) / this.KM);
        return best;
    }

    dispose() {
        for (const c of this.list) {
            this.scene.remove(c.body.group, c.beacon);
            c.body.group.traverse(o => { (o as THREE.Mesh).geometry?.dispose(); });
        }
        this.labels.dispose();
    }
}

// ---------------------------------------------------------------------------
// The conversation window
// ---------------------------------------------------------------------------

export class DialogBox {
    private root: HTMLDivElement;
    private lines: HTMLDivElement;
    private opts: HTMLDivElement;
    private busy = false;
    private talk: Conversation | null = null;
    private creature: { spec: CreatureSpec } | null = null;
    onQuest?: (q: QuestOffer, spec: CreatureSpec) => void;
    onClose?: () => void;

    private onKey = (e: KeyboardEvent) => {
        if (!this.open) return;
        if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.close(); return; }
        const n = /^Digit([1-4])$/.exec(e.code);
        if (n) { e.stopImmediatePropagation(); this.opts.querySelectorAll('button')[Number(n[1]) - 1]?.click(); }
        // The ship's own keys are not for now.
        if (e.code === 'Space' || e.code === 'KeyT') e.stopImmediatePropagation();
    };

    constructor() {
        this.root = document.createElement('div');
        this.root.id = 'dialog';
        this.root.className = 'glass';
        this.root.hidden = true;
        this.root.innerHTML = `
            <header><span class="emoji"></span><div><b></b><small></small></div><button data-close title="Закончить разговор (Esc)">✕</button></header>
            <div class="lines"></div>
            <div class="opts"></div>
            <footer></footer>`;
        document.body.appendChild(this.root);
        this.lines = this.root.querySelector('.lines')!;
        this.opts = this.root.querySelector('.opts')!;
        this.root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
        window.addEventListener('keydown', this.onKey, true);
    }

    get open() { return !this.root.hidden; }

    start(spec: CreatureSpec, world: WorldBrief, questState: 'none' | 'active' | 'done') {
        this.talk?.cancel();
        this.creature = { spec };
        this.root.hidden = false;
        if (document.pointerLockElement) document.exitPointerLock();
        this.root.querySelector('.emoji')!.textContent = spec.emoji;
        this.root.querySelector('header b')!.textContent = spec.name;
        this.lines.innerHTML = '';
        this.opts.innerHTML = '';
        if (questState === 'active') {
            this.talk = null;
            this.root.querySelector('header small')!.textContent = spec.species;
            this.say(`Ты ещё не выполнил(а) моё поручение: «${spec.wish.title}». Я подожду.`, 'them');
            this.options(['Скоро вернусь.'], () => this.close());
            return;
        }
        this.talk = new Conversation(spec, world);
        this.root.querySelector('header small')!.textContent = `${spec.species} · ${describeAccess(this.talk.access)}`;
        this.root.querySelector('footer')!.textContent = '1–4 — ответ · Esc — закончить';
        if (questState === 'done') this.say('Ты вернулся(ась)! Поручение выполнено — спасибо. У меня есть ещё кое-что…', 'them');
        this.step(() => this.talk!.open());
    }

    private async step(next: () => Promise<DialogueTurn>) {
        if (this.busy) return;
        this.busy = true;
        this.opts.innerHTML = '';
        const typing = this.say('…', 'them typing');
        const talk = this.talk;
        let turn: DialogueTurn;
        try {
            turn = await next();
        } finally {
            typing.remove();
            this.busy = false;
        }
        if (talk !== this.talk || !this.open) return;
        if (talk.offline && talk.access) this.root.querySelector('header small')!.textContent = `${this.creature!.spec.species} · ИИ недоступен — говорит по памяти`;
        this.say(turn.line, 'them');
        if (turn.quest) {
            const q = turn.quest;
            const card = document.createElement('div');
            card.className = 'quest';
            const what = q.type === 'kill' ? `уничтожить: ${q.count} × ${ENEMY_RU[q.enemy ?? 'drone']} у тела «${q.body}»` : `долететь до «${q.body}»`;
            card.innerHTML = '<b></b><p></p><small></small>';
            card.querySelector('b')!.textContent = `📜 ${q.title}`;
            card.querySelector('p')!.textContent = q.brief;
            card.querySelector('small')!.textContent = `Цель: ${what} · награда ${q.reward}`;
            this.lines.appendChild(card);
            this.scroll();
        }
        this.options(turn.options, (text, i) => {
            if (turn.quest) {
                if (text === ACCEPT || (i === 0 && text !== DECLINE)) {
                    this.say(text, 'me');
                    this.onQuest?.(turn.quest, this.creature!.spec);
                    this.say('Лети. Я буду ждать.', 'them');
                } else {
                    this.say(text, 'me');
                    this.say('Как знаешь. Возвращайся, если передумаешь.', 'them');
                }
                this.options(['Закончить разговор'], () => this.close());
                return;
            }
            this.say(text, 'me');
            this.step(() => this.talk!.answer(text));
        });
    }

    private say(text: string, who: string): HTMLElement {
        const p = document.createElement('p');
        p.className = who;
        p.textContent = text;
        this.lines.appendChild(p);
        this.scroll();
        return p;
    }

    private scroll() { this.lines.scrollTop = this.lines.scrollHeight; }

    private options(list: string[], pick: (text: string, i: number) => void) {
        this.opts.innerHTML = '';
        list.forEach((text, i) => {
            const b = document.createElement('button');
            b.innerHTML = '<kbd></kbd><span></span>';
            b.querySelector('kbd')!.textContent = String(i + 1);
            b.querySelector('span')!.textContent = text;
            b.onclick = () => { if (!this.busy) pick(text, i); };
            this.opts.appendChild(b);
        });
    }

    close() {
        if (!this.open) return;
        this.talk?.cancel();
        this.talk = null;
        this.root.hidden = true;
        this.onClose?.();
    }

    dispose() {
        this.talk?.cancel();
        window.removeEventListener('keydown', this.onKey, true);
        this.root.remove();
    }
}

const ENEMY_RU: Record<string, string> = { drone: 'дроны', fighter: 'пиратские штурмовики', crystal: 'кристаллиды', leviathan: 'левиафан' };
