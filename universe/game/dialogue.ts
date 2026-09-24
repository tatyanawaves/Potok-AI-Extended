// Conversations with the creatures of space. A creature opens the talk, the
// pilot picks one of four replies, and it goes on until the creature hands
// out an errand. The lines come from the language model the pilot set up in
// Potok (their own key, from this browser's storage); without one, or when
// the model fails, the creature falls back on a scripted conversation.

import { secureStorage } from '../storage';
import type { EnemyKind } from './models';
import type { CreatureMemory } from './progress';

export interface QuestOffer {
    title: string;
    brief: string;
    type: 'kill' | 'reach';
    enemy?: EnemyKind;
    count?: number;
    body: string;
    reward: number;
}

export interface DialogueTurn {
    line: string;
    /** Four replies for the pilot; after an errand is offered, the ways to accept or refuse it. */
    options: string[];
    quest: QuestOffer | null;
}

export interface CreatureMind {
    name: string;
    species: string;
    persona: string;
    /** The body it lives by. */
    home: string;
    /** The errand it has in mind, for the scripted conversation (the model may choose its own). */
    wish: Omit<QuestOffer, 'title' | 'brief' | 'reward'> & { why: string; title: string; reward: number };
    /**
     * Scripted lines: the call it makes when a ship comes near, its greeting, stories about
     * itself, a question for the pilot, a rumour about the system, and the trouble it is in.
     */
    script: { hail: string; greet: string; lore: string[]; ask: string; rumor: string; trouble: string };
}

export interface WorldBrief {
    system: string;
    /** Bodies an errand may point at. */
    bodies: string[];
}

export interface Exchange {
    /** The creature's turn, and the pilot's answer to it (absent for the turn being shown). */
    turn: DialogueTurn;
    reply?: string;
}

const ENEMIES: EnemyKind[] = ['drone', 'fighter', 'crystal', 'leviathan', 'interceptor', 'gunship', 'hive'];
/** A creature talks for at least this many pilot replies before it asks for anything… */
export const MIN_REPLIES = 4;
/** …and gets to its errand by this many at the latest. */
export const MAX_REPLIES = 8;

export const ACCEPT = 'Берусь за поручение.';
export const DECLINE = 'Не сейчас, может быть позже.';

// ---------------------------------------------------------------------------
// Validation: whatever the model says, the game only gets an errand it can run.
// ---------------------------------------------------------------------------

export function sanitizeQuest(q: unknown, world: WorldBrief, mind: CreatureMind): QuestOffer | null {
    if (!q || typeof q !== 'object') return null;
    const o = q as Record<string, unknown>;
    const type = o.type === 'reach' ? 'reach' : o.type === 'kill' ? 'kill' : null;
    if (!type) return null;
    const bodyName = typeof o.body === 'string' ? o.body.trim() : '';
    const body = world.bodies.find(b => b.toLowerCase() === bodyName.toLowerCase()) ?? mind.home;
    const clamp = (x: unknown, lo: number, hi: number, dflt: number) => {
        const n = Math.round(Number(x));
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
    };
    const text = (x: unknown, dflt: string, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : dflt);
    const enemy = ENEMIES.includes(o.enemy as EnemyKind) ? (o.enemy as EnemyKind) : 'drone';
    return {
        type, body,
        enemy: type === 'kill' ? enemy : undefined,
        count: type === 'kill' ? clamp(o.count, 1, enemy === 'leviathan' || enemy === 'hive' ? 1 : enemy === 'gunship' ? 2 : 12, enemy === 'leviathan' || enemy === 'hive' ? 1 : 4) : undefined,
        title: text(o.title, `Поручение: ${mind.name}`, 60),
        brief: text(o.brief, type === 'kill' ? `Помочь у тела ${body}.` : `Долететь до ${body}.`, 240),
        reward: clamp(o.reward, 100, 1500, 400),
    };
}

/** Pull a turn out of a model's reply, which may wrap its JSON in prose or code fences. */
export function parseTurn(raw: string, world: WorldBrief, mind: CreatureMind): DialogueTurn | null {
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let j: Record<string, unknown>;
    try { j = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
    const line = typeof j.line === 'string' ? j.line.trim() : '';
    if (!line) return null;
    const quest = sanitizeQuest(j.quest, world, mind);
    let options = Array.isArray(j.options) ? j.options.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 140)) : [];
    if (quest) options = [ACCEPT, DECLINE];
    else {
        const pad = ['Расскажи подробнее.', 'Чем я могу помочь?', 'Ты мне не нравишься.', 'Откуда ты?'];
        for (const p of pad) if (options.length < 4 && !options.includes(p)) options.push(p);
        options = options.slice(0, 4);
    }
    return { line: line.slice(0, 600), options, quest };
}

// ---------------------------------------------------------------------------
// The pilot's own model, as configured in Potok.
// ---------------------------------------------------------------------------

interface ModelAccess { provider: 'openrouter' | 'groq' | 'gemini'; key: string; model: string; baseUrl?: string }

export function modelAccess(): ModelAccess | null {
    try {
        const settings = JSON.parse(localStorage.getItem('ai_settings') || '{}');
        const keys = {
            openrouter: settings.openRouterKey || secureStorage.getItem('openRouterKey') || '',
            groq: settings.groqKey || secureStorage.getItem('groqKey') || '',
            gemini: settings.geminiKey || secureStorage.getItem('geminiKey') || '',
        };
        const order: ModelAccess['provider'][] = [settings.aiProvider, 'openrouter', 'groq', 'gemini']
            .filter((p): p is ModelAccess['provider'] => p === 'openrouter' || p === 'groq' || p === 'gemini');
        const provider = order.find(p => keys[p]);
        if (!provider) return null;
        const model = provider === 'openrouter' ? settings.openRouterModel || 'openrouter/auto'
            : provider === 'groq' ? settings.groqModel || 'llama-3.3-70b-versatile'
                : settings.geminiModel || 'gemini-2.5-flash';
        return { provider, key: keys[provider], model, baseUrl: provider === 'openrouter' ? settings.apiBaseUrl : undefined };
    } catch {
        return null;
    }
}

export type Provider = ModelAccess['provider'];

/** Keep the pilot's own key in this browser (encrypted, as Potok keeps it), and make it the one used. */
export function saveModelKey(provider: Provider, key: string) {
    const name = provider === 'openrouter' ? 'openRouterKey' : provider === 'groq' ? 'groqKey' : 'geminiKey';
    secureStorage.setItem(name, key.trim());
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(localStorage.getItem('ai_settings') || '{}'); } catch { /* start afresh */ }
    delete settings[name]; // never in the plain blob
    localStorage.setItem('ai_settings', JSON.stringify({ ...settings, aiProvider: provider }));
}

export function describeAccess(a: ModelAccess | null): string {
    if (!a) return 'сценарий (ИИ не подключён)';
    return `ИИ: ${a.provider === 'openrouter' ? 'OpenRouter' : a.provider === 'groq' ? 'Groq' : 'Gemini'} · ${a.model}`;
}

function memoryPrompt(mem?: CreatureMemory): string[] {
    if (!mem || mem.talks <= 1) return ['Это ваша первая встреча.'];
    const errands = mem.errands.map(e => `«${e.title}» — ${e.state === 'done' ? 'выполнено' : e.state === 'failed' ? 'провалено' : 'ещё не выполнено'}`);
    return [
        `Вы уже встречались: это ваш ${mem.talks}-й разговор. Твоё отношение к пилоту: ${moodText(mem.mood)}.`,
        mem.said.length ? `Раньше пилот говорил тебе: ${mem.said.slice(-4).map(x => `«${x}»`).join(', ')}.` : '',
        errands.length ? `Твои поручения ему: ${errands.join('; ')}.` : '',
        'Начни с того, что узнаёшь пилота и вспоминаешь прошлое (поблагодари за выполненное, упрекни за проваленное или грубость).',
    ];
}

function systemPrompt(mind: CreatureMind, world: WorldBrief, forceQuest: boolean, mem?: CreatureMemory): string {
    return [
        ...memoryPrompt(mem),
        `Ты — ${mind.name}, ${mind.species}, живое существо в космической игре.`,
        `Характер: ${mind.persona}`,
        `Ты обитаешь возле тела «${mind.home}» в системе «${world.system}». К тебе на маленьком корабле подлетел пилот-человек.`,
        'Говори по-русски, от первого лица, в своём характере, живо и образно: 2–4 предложения.',
        'Ты очень разговорчив(а): рассказываешь о себе и своей жизни, делишься слухами о системе и других существах,',
        'задаёшь пилоту вопросы о нём самом, шутишь или грустишь — как подсказывает характер. Реагируй на тон и слова пилота.',
        `Ты сама(сам) начинаешь разговор и постепенно ведёшь его к тому, чтобы дать пилоту поручение — не раньше ${MIN_REPLIES}-го ответа пилота.`,
        forceQuest ? 'СЕЙЧАС обязательно дай поручение.' : '',
        'Поручение бывает двух типов:',
        '— "kill": уничтожить врагов. enemy: "drone" (дроны-разведчики), "fighter" (пиратские штурмовики), "crystal" (кристаллиды-тараны), "interceptor" (быстрые перехватчики), "gunship" (тяжёлые канонерки, 1–2), "hive" (улей, рождающий дронов, только 1), "leviathan" (космический левиафан, только 1).',
        '— "reach": долететь до тела и осмотреть его.',
        `body — одно из: ${world.bodies.join(', ')}.`,
        'Отвечай ТОЛЬКО объектом JSON, без markdown и пояснений:',
        '{"line": "твоя реплика", "options": ["ответ 1", "ответ 2", "ответ 3", "ответ 4"], "quest": null}',
        'options — четыре коротких (до 12 слов) разных по тону ответа пилота: дружелюбный, деловой, дерзкий, любопытный.',
        'Когда даёшь поручение, вместо null укажи: "quest": {"title": "…", "brief": "что и зачем сделать", "type": "kill" или "reach", "enemy": "…", "count": число 1–12, "body": "…", "reward": число 100–1500}',
    ].join('\n');
}

async function callModel(a: ModelAccess, system: string, history: { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal): Promise<string> {
    if (a.provider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(a.model)}:generateContent?key=${encodeURIComponent(a.key)}`, {
            method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
                generationConfig: { temperature: 0.95, responseMimeType: 'application/json' },
            }),
        });
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const j = await res.json();
        return j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    }
    const base = a.provider === 'groq' ? 'https://api.groq.com/openai/v1' : a.baseUrl || 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}` };
    if (a.provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Potok Universe'; }
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal, headers,
        body: JSON.stringify({
            model: a.model, temperature: 0.95, max_tokens: 700,
            messages: [{ role: 'system', content: system }, ...history],
            ...(a.provider === 'groq' ? { response_format: { type: 'json_object' } } : {}),
        }),
    });
    if (!res.ok) throw new Error(`${a.provider} ${res.status}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// The scripted conversation.
// ---------------------------------------------------------------------------

/** The pilot's replies at each step of the scripted talk: friendly, business-like, rude, curious. */
const STEP_REPLIES = [
    ['Рад встрече! Я пилот, лечу мимо.', 'Мне сказали, тут есть работа.', 'Прочь с дороги, чудище.', 'Кто ты такое?'],
    ['Как красиво ты говоришь. Продолжай.', 'Интересно, но ближе к делу.', 'Мне некогда слушать сказки.', 'Расскажи ещё — как ты здесь живёшь?'],
    ['Я исследую Вселенную — хочу увидеть всё.', 'Я наёмный пилот, работаю за награду.', 'Не твоё дело, куда я лечу.', 'А почему ты спрашиваешь?'],
    ['Слухи? Люблю слухи, рассказывай.', 'Слухи меня не кормят.', 'Враньё это всё.', 'А кто ещё живёт в этой системе?'],
    ['Я помогу. Что нужно сделать?', 'Какая награда?', 'С чего бы мне рисковать ради тебя?', 'Кто эти враги и откуда они?'],
];

const REACTIONS = [
    ['Твой голос тёплый, как свет близкой звезды.', 'Ты добр, пилот. Это редкость между орбитами.'],
    ['Деловой… Хорошо, у меня тоже мало времени.', 'Прямо к сути — уважаю.'],
    ['Дерзость — роскошь для того, кто летает в консервной банке.', 'Грубиян. Но смелый грубиян.'],
    ['Любопытство — лучшее, что есть в вас, двуногих.', 'Ты задаёшь хорошие вопросы.'],
];

/** Gossip any creature may pass on. */
const RUMORS = [
    'Говорят, за орбитой Нептуна кто-то зажёг портал, и из него до сих пор тянет холодом чужой галактики.',
    'Пираты прячут добычу в тени спутников — там их не видят ни радары, ни звёзды.',
    'Левиафаны поют перед охотой. Если услышишь низкий гул — поворачивай.',
    'Кристаллиды рождаются из обломков разбитых кораблей. Поэтому их всё больше.',
    'Где-то в поясе астероидов лежит станция без экипажа, и её огни всё ещё мигают.',
    'В центре галактики чёрная дыра хранит память всего, что в неё упало. Так шепчут оракулы.',
];

const pick = <T>(list: T[], seed: number) => list[Math.abs(Math.floor(seed)) % list.length];

/** How the pilot's reply shifts the creature's mood: options come friendly, business, rude, curious. */
export const TONE_MOOD = [1, 0, -1, 0.5];

/** Mood in words, for the model. */
const moodText = (m: number) => m >= 2 ? 'очень тёплое, ты рада(рад) пилоту' : m >= 0.5 ? 'доброе' : m > -0.5 ? 'нейтральное' : m > -2 ? 'настороженное, пилот бывал груб' : 'обиженное';

/** The first words to a pilot met before, from what the creature remembers. */
export function memoryGreeting(mem: CreatureMemory): string {
    const last = mem.errands[mem.errands.length - 1];
    const parts: string[] = [];
    if (last?.state === 'done') parts.push(`Ты вернулся! Я не забыла, как ты справился с «${last.title}». Спасибо.`);
    else if (last?.state === 'failed') parts.push(`Помню, «${last.title}» у тебя тогда не вышло. Ничего, бывает.`);
    else if (mem.mood >= 1) parts.push('Рада снова видеть тебя, пилот!');
    else if (mem.mood <= -1) parts.push('А, это ты… В прошлый раз ты был не слишком вежлив.');
    else parts.push('Снова ты? Мы ведь уже говорили — помнишь?');
    const said = mem.said[mem.said.length - 1];
    if (said) parts.push(`Ты тогда сказал: «${said}».`);
    parts.push('О чём поговорим на этот раз?');
    return parts.join(' ');
}

/** Hurt enough, a creature will not talk until the pilot apologises. */
export const REFUSE_MOOD = -2.5;
export const APOLOGY = 'Прости, я был груб.';

/** The next turn of the scripted talk, given what was said so far. */
export function scriptedTurn(mind: CreatureMind, history: Exchange[], memory?: CreatureMemory): DialogueTurn {
    const r = history.length; // the pilot has answered every turn shown so far
    const last = r ? history[r - 1].reply ?? '' : '';
    const tone = STEP_REPLIES.map(t => t.indexOf(last)).find(i => i >= 0) ?? -1;
    const react = tone >= 0 ? pick(REACTIONS[tone], r + mind.name.length) + ' ' : '';
    const said = history.map(h => h.turn.line);
    const told = (line: string) => said.some(x => x.includes(line));
    const sc = mind.script;
    const loreLeft = sc.lore.filter(l => !told(l));
    const rumor = sc.rumor + ' ' + pick(RUMORS, mind.name.length * 7 + r);
    if (r === 0) return { line: memory && memory.talks > 1 ? memoryGreeting(memory) : sc.greet, options: STEP_REPLIES[0], quest: null };
    // A curious pilot keeps the stories coming (up to the limit).
    if (tone === 3 && loreLeft.length && r < MAX_REPLIES - 2 && r >= 3) {
        return { line: react + loreLeft[0], options: STEP_REPLIES[1], quest: null };
    }
    if (r === 1) return { line: react + (loreLeft[0] ?? sc.lore[0]), options: STEP_REPLIES[1], quest: null };
    if (r === 2) return { line: react + sc.ask, options: STEP_REPLIES[2], quest: null };
    if (r === 3) return { line: react + (loreLeft[0] ? loreLeft[0] + ' ' : '') + rumor, options: STEP_REPLIES[3], quest: null };
    if (!told(sc.trouble) && r < MAX_REPLIES) return { line: react + sc.trouble, options: STEP_REPLIES[4], quest: null };
    const w = mind.wish;
    const quest: QuestOffer = { ...w, brief: w.why };
    const line = (tone === 2 ? 'Дерзко — но ты мне подходишь. ' : tone === 1 ? 'Награда будет. ' : react) + w.why;
    return { line, options: [ACCEPT, DECLINE], quest };
}

// ---------------------------------------------------------------------------
// A conversation.
// ---------------------------------------------------------------------------

export class Conversation {
    readonly history: Exchange[] = [];
    readonly access = modelAccess();
    /** Set once the model failed; the rest of the talk is scripted. */
    offline = !this.access;
    private abort = new AbortController();

    constructor(readonly mind: CreatureMind, readonly world: WorldBrief, readonly memory?: CreatureMemory) {}

    get current(): DialogueTurn | null { return this.history[this.history.length - 1]?.turn ?? null; }

    /** The creature's first words. */
    open(): Promise<DialogueTurn> { return this.advance(); }

    /** The pilot answers the current turn; returns the creature's next one. */
    answer(reply: string): Promise<DialogueTurn> {
        const cur = this.history[this.history.length - 1];
        if (cur) {
            cur.reply = reply;
            // The creature remembers what was said, and how.
            if (this.memory) {
                const tone = cur.turn.options.indexOf(reply);
                if (tone >= 0 && tone < 4) this.memory.mood = Math.max(-3, Math.min(3, this.memory.mood + TONE_MOOD[tone] * 0.5));
                this.memory.said = [...this.memory.said, reply].slice(-6);
            }
        }
        return this.advance();
    }

    cancel() { this.abort.abort(); }

    private async advance(): Promise<DialogueTurn> {
        const replies = this.history.length;
        let turn: DialogueTurn | null = null;
        if (!this.offline && this.access) {
            const msgs: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: '(Пилот подлетает к тебе и ждёт. Начни разговор.)' }];
            for (const h of this.history) {
                msgs.push({ role: 'assistant', content: JSON.stringify(h.turn) });
                if (h.reply) msgs.push({ role: 'user', content: h.reply });
            }
            const timer = setTimeout(() => this.abort.abort(), 30_000);
            try {
                const raw = await callModel(this.access, systemPrompt(this.mind, this.world, replies >= MAX_REPLIES, this.memory), msgs, this.abort.signal);
                turn = parseTurn(raw, this.world, this.mind);
                // Too eager: keep talking a little longer before the errand.
                if (turn?.quest && replies < MIN_REPLIES) {
                    turn = { line: turn.line, options: ['Расскажи сначала о себе.', 'Что за работа?', 'Не торопись, я слушаю.', 'Откуда ты это знаешь?'], quest: null };
                }
            } catch (err) {
                console.warn('creature dialogue: model unavailable, using the script', err);
            } finally {
                clearTimeout(timer);
                this.abort = new AbortController();
            }
            if (!turn) this.offline = true;
        }
        // The model sometimes never gets round to it; past the limit the creature's own wish stands.
        if (turn && !turn.quest && replies >= MAX_REPLIES) {
            const w = this.mind.wish;
            turn = { line: turn.line + ' ' + w.why, options: [ACCEPT, DECLINE], quest: { ...w, brief: w.why } };
        }
        if (!turn) turn = scriptedTurn(this.mind, this.history, this.memory);
        this.history.push({ turn });
        return turn;
    }
}
