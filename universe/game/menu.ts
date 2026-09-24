// The game menu (Tab): the pilot and the save, upgrades bought with score,
// the ship's look, and every mission log so far.

import { MAX_LEVEL, progress, ShipLook, ShipVariant, UPGRADES } from './progress';
import { objectiveText } from './missions';
import { snapshotLogs } from './shipGame';

type Tab = 'pilot' | 'skills' | 'ship' | 'missions';

const HULLS = ['#8a929e', '#e8e4dc', '#2d3440', '#9a3b2e', '#2f5d8a', '#c79a2e'];
const ACCENTS = ['#5c6573', '#1d1f24', '#b84a3a', '#3a7bb8', '#5aa05a', '#8a5ac0'];
const GLOWS = ['#4aa8ff', '#ff6a2a', '#7dff8a', '#ff4fd8', '#ffe066', '#ffffff'];
const VARIANTS: [ShipVariant, string][] = [['classic', 'Перехватчик'], ['delta', 'Дельта-крыло'], ['heavy', 'Тяжёлый штурмовик']];

const placeName = (key: string) => {
    const [, sys, planet] = key.split(':');
    const system = sys === 'sun' ? 'Солнечная система' : `Система №${sys}`;
    return planet ? `${planet} — поверхность (${system})` : system;
};

const fmtTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h} ч ${m} мин` : `${m} мин`;
};

export class GameMenu {
    private root: HTMLDivElement;
    private body: HTMLDivElement;
    private tab: Tab = 'pilot';
    /** Save now (the host also puts the current place into the save). */
    onSave?: () => void;
    onNewGame?: () => void;

    constructor() {
        this.root = document.createElement('div');
        this.root.id = 'gamemenu';
        this.root.className = 'glass';
        this.root.hidden = true;
        this.root.innerHTML = `
            <header>
                <nav>
                    <button data-tab="pilot">👤 Пилот</button>
                    <button data-tab="skills">⭐ Навыки</button>
                    <button data-tab="ship">🛠 Корабль</button>
                    <button data-tab="missions">🎯 Миссии</button>
                </nav>
                <button data-close title="Закрыть (Tab / Esc)">✕</button>
            </header>
            <div class="body"></div>`;
        document.body.appendChild(this.root);
        this.body = this.root.querySelector('.body')!;
        this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => {
            b.onclick = () => { this.tab = b.dataset.tab as Tab; this.render(); };
        });
        this.root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.toggle(false);
        progress.onChange(() => { if (this.isOpen) this.render(); });
        window.addEventListener('keydown', e => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
            if (e.code === 'Tab') { e.preventDefault(); this.toggle(); }
            else if (e.code === 'Escape' && this.isOpen) { e.stopImmediatePropagation(); this.toggle(false); }
        }, true);
    }

    get isOpen() { return !this.root.hidden; }

    toggle(open = !this.isOpen) {
        this.root.hidden = !open;
        if (open) {
            if (document.pointerLockElement) document.exitPointerLock();
            snapshotLogs();
            this.render();
        }
    }

    private render() {
        this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === this.tab));
        this.body.innerHTML = '';
        if (this.tab === 'pilot') this.renderPilot();
        else if (this.tab === 'skills') this.renderSkills();
        else if (this.tab === 'ship') this.renderShip();
        else this.renderMissions();
    }

    private el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
        const e = document.createElement(tag);
        if (text) e.textContent = text;
        if (cls) e.className = cls;
        return e;
    }

    private renderPilot() {
        const d = progress.data;
        const stats = this.el('div', '', 'stats');
        const row = (k: string, v: string) => { const r = this.el('div', '', 'row'); r.append(this.el('span', k), this.el('b', v)); stats.append(r); };
        row('Очки (на них покупаются навыки)', String(Math.round(d.score)));
        row('Уничтожено врагов', String(d.stats.kills));
        row('Выполнено поручений существ', String(d.stats.errands));
        row('Существ знакомо', String(Object.values(d.creatures).filter(c => c.talks > 0).length));
        row('Время в игре', fmtTime(d.stats.seconds));
        row('Сохранено', d.savedAt ? new Date(d.savedAt).toLocaleTimeString('ru-RU') : '—');
        this.body.append(stats);
        const actions = this.el('div', '', 'actions');
        const save = this.el('button', '💾 Сохранить');
        save.onclick = () => { this.onSave?.(); this.render(); };
        const reset = this.el('button', '🔄 Новая игра', 'danger');
        reset.onclick = () => {
            if (confirm('Начать новую игру? Очки, навыки, миссии и память существ будут стёрты.')) this.onNewGame?.();
        };
        actions.append(save, reset);
        this.body.append(actions, this.el('p', 'Игра сохраняется сама каждые 15 секунд и при переходах между местами — в этом браузере.', 'note'));
    }

    private renderSkills() {
        this.body.append(this.el('p', `Очки: ${Math.round(progress.data.score)} — тратьте их на улучшения корабля.`, 'note'));
        for (const u of UPGRADES) {
            const level = progress.level(u.id);
            const cost = progress.nextCost(u.id);
            const card = this.el('div', '', 'skill');
            const info = this.el('div');
            info.append(this.el('b', `${u.icon} ${u.title}`), this.el('small', `Уровень ${level}/${MAX_LEVEL} · сейчас: ${u.effect(level)}${cost !== null ? ` → ${u.effect(level + 1)}` : ''}`));
            const pips = this.el('span', '●'.repeat(level) + '○'.repeat(MAX_LEVEL - level), 'pips');
            const buy = this.el('button', cost === null ? 'Максимум' : `Купить · ${cost}`);
            buy.disabled = cost === null || progress.data.score < cost;
            buy.onclick = () => { progress.buy(u.id); };
            card.append(info, pips, buy);
            this.body.append(card);
        }
    }

    private renderShip() {
        const look = progress.data.look;
        const section = (title: string, colors: string[], key: keyof ShipLook) => {
            this.body.append(this.el('h4', title));
            const row = this.el('div', '', 'swatches');
            for (const c of colors) {
                const b = this.el('button', '', 'swatch');
                b.style.background = c;
                b.classList.toggle('active', look[key] === c);
                b.title = c;
                b.onclick = () => progress.setLook({ [key]: c } as Partial<ShipLook>);
                row.append(b);
            }
            const custom = this.el('input') as HTMLInputElement;
            custom.type = 'color';
            custom.value = look[key] as string;
            custom.title = 'Свой цвет';
            custom.onchange = () => progress.setLook({ [key]: custom.value } as Partial<ShipLook>);
            row.append(custom);
            this.body.append(row);
        };
        this.body.append(this.el('h4', 'Корпус'));
        const variants = this.el('div', '', 'variants');
        for (const [v, name] of VARIANTS) {
            const b = this.el('button', name);
            b.classList.toggle('active', look.variant === v);
            b.onclick = () => progress.setLook({ variant: v });
            variants.append(b);
        }
        this.body.append(variants);
        section('Цвет корпуса', HULLS, 'hull');
        section('Цвет крыльев и деталей', ACCENTS, 'accent');
        section('Пламя двигателей', GLOWS, 'glow');
        this.body.append(this.el('p', 'Изменения видны сразу — посмотрите на корабль (V — вид от 3-го лица).', 'note'));
    }

    private renderMissions() {
        const logs = Object.entries(progress.data.logs);
        if (!logs.length) { this.body.append(this.el('p', 'Пока нет миссий. В системе нажмите M, чтобы взять задание, или поговорите с существом (T).', 'note')); return; }
        for (const [key, log] of logs) {
            this.body.append(this.el('h4', placeName(key)));
            for (const m of log.missions) {
                const card = this.el('div', '', `mission ${m.state}`);
                const state = m.state === 'done' ? '✓ выполнена' : m.state === 'active' ? '● активна' : m.state === 'failed' ? '✕ провалена' : 'доступна';
                card.append(this.el('b', m.title), this.el('small', `${m.giver ? `От: ${m.giver} · ` : ''}${state} · награда ${m.reward}`));
                if (m.state === 'active') for (const o of m.objectives) card.append(this.el('div', objectiveText(o), 'obj'));
                this.body.append(card);
            }
        }
    }
}
