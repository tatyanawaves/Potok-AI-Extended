// Conversations with the creatures of space. A creature opens the talk, the
// pilot picks one of four replies, and it goes on until the creature hands
// out an errand. The lines come from the language model the pilot set up in
// Potok (their own key, from this browser's storage); without one, or when
// the model fails, the creature falls back on a scripted conversation.

import { secureStorage } from '../../services/encryption';
import type { EnemyKind } from './models';

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
    /** Scripted lines: greeting, lore about itself, and the trouble it is in. */
    script: { greet: string; lore: string[]; trouble: string };
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

const ENEMIES: EnemyKind[] = ['drone', 'fighter', 'crystal', 'leviathan'];
/** A creature gets to its errand by this many pilot replies at the latest. */
export const MAX_REPLIES = 5;

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
        count: type === 'kill' ? clamp(o.count, 1, enemy === 'leviathan' ? 1 : 12, enemy === 'leviathan' ? 1 : 4) : undefined,
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

export function describeAccess(a: ModelAccess | null): string {
    if (!a) return 'сценарий (ключ ИИ не найден — добавьте его в настройках Потока)';
    return `ИИ: ${a.provider === 'openrouter' ? 'OpenRouter' : a.provider === 'groq' ? 'Groq' : 'Gemini'} · ${a.model}`;
}

function systemPrompt(mind: CreatureMind, world: WorldBrief, forceQuest: boolean): string {
    return [
        `Ты — ${mind.name}, ${mind.species}, живое существо в космической игре.`,
        `Характер: ${mind.persona}`,
        `Ты обитаешь возле тела «${mind.home}» в системе «${world.system}». К тебе на маленьком корабле подлетел пилот-человек.`,
        'Говори по-русски, от первого лица, в своём характере, образно, но коротко: 1–3 предложения.',
        'Ты сама(сам) начинаешь разговор и ведёшь его к тому, чтобы дать пилоту поручение. Реагируй на тон пилота.',
        `Обычно поручение даётся после 2–4 ответов пилота. ${forceQuest ? 'СЕЙЧАС обязательно дай поручение.' : ''}`,
        'Поручение бывает двух типов:',
        '— "kill": уничтожить врагов. enemy: "drone" (дроны-разведчики), "fighter" (пиратские штурмовики), "crystal" (кристаллиды-тараны), "leviathan" (космический левиафан, только 1).',
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

const TONE_REPLIES = [
    // friendly, business, rude, curious
    ['Рад встрече! Я пилот, лечу мимо.', 'Мне сказали, тут есть работа.', 'Прочь с дороги, чудище.', 'Кто ты такое?'],
    ['Звучит красиво. Что тебя тревожит?', 'Ближе к делу: чем могу помочь?', 'Мне некогда слушать сказки.', 'Расскажи ещё — как ты здесь живёшь?'],
    ['Я помогу. Что нужно сделать?', 'Какая награда?', 'С чего бы мне рисковать ради тебя?', 'Кто эти враги и откуда они?'],
];

const REACTIONS = [
    'Твой голос тёплый, как свет близкой звезды.',
    'Деловой… Хорошо, у меня тоже мало времени.',
    'Дерзость — роскошь для того, кто летает в консервной банке.',
    'Любопытство — лучшее, что есть в вас, двуногих.',
];

/** The next turn of the scripted talk, given what was said so far. */
export function scriptedTurn(mind: CreatureMind, history: Exchange[]): DialogueTurn {
    const replies = history.length; // the pilot has answered every turn shown so far
    const last = replies ? history[replies - 1].reply ?? '' : '';
    const tone = TONE_REPLIES.map(t => t.indexOf(last)).find(i => i >= 0) ?? -1;
    const react = tone >= 0 ? REACTIONS[tone] + ' ' : '';
    const said = history.map(h => h.turn.line);
    const loreShown = mind.script.lore.filter(l => said.some(x => x.includes(l))).length;
    const troubleShown = said.some(x => x.includes(mind.script.trouble));
    if (replies === 0) return { line: mind.script.greet, options: TONE_REPLIES[0], quest: null };
    // The curious hear more about the creature before the errand, up to the reply limit.
    const wantsLore = replies === 1 || (tone === 3 && replies < MAX_REPLIES - 1);
    if (wantsLore && loreShown < mind.script.lore.length) {
        return { line: react + mind.script.lore[loreShown], options: TONE_REPLIES[1], quest: null };
    }
    if (!troubleShown && replies < MAX_REPLIES) {
        return { line: react + mind.script.trouble, options: TONE_REPLIES[2], quest: null };
    }
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

    constructor(readonly mind: CreatureMind, readonly world: WorldBrief) {}

    get current(): DialogueTurn | null { return this.history[this.history.length - 1]?.turn ?? null; }

    /** The creature's first words. */
    open(): Promise<DialogueTurn> { return this.advance(); }

    /** The pilot answers the current turn; returns the creature's next one. */
    answer(reply: string): Promise<DialogueTurn> {
        const cur = this.history[this.history.length - 1];
        if (cur) cur.reply = reply;
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
                const raw = await callModel(this.access, systemPrompt(this.mind, this.world, replies >= MAX_REPLIES), msgs, this.abort.signal);
                turn = parseTurn(raw, this.world, this.mind);
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
        if (!turn) turn = scriptedTurn(this.mind, this.history);
        this.history.push({ turn });
        return turn;
    }
}
