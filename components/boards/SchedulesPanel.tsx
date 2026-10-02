import React, { useEffect, useState } from 'react';
import { AISettings } from '../../types';
import { Schedule, STEP_MINUTES, describeSchedule } from '../../services/schedule';
import { subscribeToSchedules, createSchedule, setScheduleEnabled, deleteSchedule, schedulesAvailable } from '../../services/schedules';

/**
 * The board's scheduled bot requests: "every weekday at 9:00, @bot do this".
 * Each runs on the server as the member who made it, in the channel it was
 * made in, and the bot's reply lands there as usual.
 */

interface SchedulesPanelProps {
    boardId: string;
    channel: { id: string, name: string };
    bots: string[];
    currentUid: string;
    currentName: string;
    isOwner: boolean;
    settings: AISettings;
    t: any;
    onClose: () => void;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const SchedulesPanel: React.FC<SchedulesPanelProps> = ({ boardId, channel, bots, currentUid, currentName, isOwner, settings, t, onClose }) => {
    const language = settings.language || 'ru';
    const dayNames: string[] = language === 'en'
        ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
        : language === 'kk' ? ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'] : ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [bot, setBot] = useState(bots[0] || '');
    const [text, setText] = useState('');
    const [time, setTime] = useState('09:00');
    const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => subscribeToSchedules(boardId, setSchedules), [boardId]);
    useEffect(() => { if (!bots.includes(bot)) setBot(bots[0] || ''); }, [bots, bot]);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const add = async () => {
        if (!bot || !text.trim()) return;
        // Times between ticks fire in the tick before them; say what will happen.
        const [h, m] = time.split(':').map(Number);
        const rounded = `${String(h).padStart(2, '0')}:${String(m - m % STEP_MINUTES).padStart(2, '0')}`;
        setBusy(true);
        setError(null);
        try {
            await createSchedule(boardId, {
                bot, text: text.trim(), time: rounded, days, tz,
                channelId: channel.id, channelName: channel.name,
                createdByName: currentName
            }, settings);
            setText('');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(d => d !== day) : [...current, day]);

    return (
        <aside className="absolute lg:relative inset-y-0 right-0 z-20 w-full max-w-md lg:w-96 shrink-0 border-l border-slate-800 bg-slate-900 lg:bg-slate-900/30 flex flex-col shadow-2xl lg:shadow-none">
            <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-amber-300/80 flex items-center justify-between">
                <span>{t.schedules || 'Расписание'} · {schedules.length}</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white" title={t.close || 'Закрыть'}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {schedules.length === 0 && (
                    <p className="text-xs text-slate-500">{t.schedulesEmpty || 'Пока ничего. Например: по будням в 9:00 — @бот, сводка новостей по теме.'}</p>
                )}
                {schedules.map(s => {
                    const mine = s.createdBy === currentUid;
                    return (
                        <div key={s.id} className={`rounded-xl border p-3 text-xs ${s.enabled ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800 opacity-60'}`}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-amber-200">{describeSchedule(s, language)}</span>
                                <span className="text-slate-500 truncate">#{s.channelName} · {s.createdByName}</span>
                            </div>
                            <p className="mt-1 text-slate-300 break-words"><span className="text-cyan-300">@{s.bot}</span> {s.text}</p>
                            {s.tz !== tz && <p className="mt-1 text-[10px] text-slate-500">{s.tz}</p>}
                            {s.lastError && <p className="mt-1 text-[10px] text-red-400">{s.lastError}</p>}
                            {(mine || isOwner) && (
                                <div className="mt-2 flex gap-3 text-[11px] font-mono">
                                    {mine && (
                                        <button onClick={() => setScheduleEnabled(boardId, s.id, !s.enabled).catch(e => setError(String(e)))} className="text-slate-400 hover:text-white">
                                            {s.enabled ? (t.pause || 'пауза') : (t.resume || 'включить')}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => window.confirm(`${t.deleteScheduleConfirm || 'Удалить расписание'}?`) && deleteSchedule(boardId, s.id).catch(e => setError(String(e)))}
                                        className="text-slate-500 hover:text-red-400"
                                    >
                                        {t.delete || 'удалить'}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="shrink-0 border-t border-slate-800 p-3 space-y-2">
                {!schedulesAvailable() ? (
                    <p className="text-xs text-slate-500">{t.schedulesNeedServer || 'Расписание работает на сервере, а он не подключён.'}</p>
                ) : bots.length === 0 ? (
                    <p className="text-xs text-slate-500">{t.schedulesNeedBot || 'Сначала добавьте на доску бота.'}</p>
                ) : (
                    <>
                        <div className="flex gap-2">
                            <select value={bot} onChange={e => setBot(e.target.value)} className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
                                {bots.map(name => <option key={name} value={name}>@{name}</option>)}
                            </select>
                            <input
                                type="time"
                                step={STEP_MINUTES * 60}
                                value={time}
                                onChange={e => setTime(e.target.value || '09:00')}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                            />
                        </div>
                        <div className="flex gap-1">
                            {DAY_ORDER.map(day => (
                                <button
                                    key={day}
                                    onClick={() => toggleDay(day)}
                                    className={`flex-1 py-1 rounded text-[10px] font-mono border ${days.includes(day) ? 'border-amber-500/50 text-amber-200 bg-amber-950/30' : 'border-slate-800 text-slate-500'}`}
                                >
                                    {dayNames[day]}
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder={t.schedulePlaceholder || 'Что попросить, например: собери свежие новости по теме и сделай сводку'}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 resize-none h-16"
                        />
                        {error && <p className="text-[11px] text-red-400">{error}</p>}
                        <button
                            onClick={add}
                            disabled={busy || !text.trim() || !bot}
                            className="w-full py-2 rounded-xl bg-amber-700/80 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-40"
                        >
                            {busy ? '…' : `${t.addSchedule || 'Добавить в'} #${channel.name}`}
                        </button>
                        <p className="text-[10px] text-slate-500">{t.scheduleCostNote || 'Запросы идут от вашего имени и на вашем ключе. Время —'} {tz}</p>
                    </>
                )}
            </div>
        </aside>
    );
};

export default SchedulesPanel;
