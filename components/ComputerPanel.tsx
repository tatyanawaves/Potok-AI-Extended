import React, { useCallback, useEffect, useState } from 'react';
import { machine, downloadFromMachine, MachineInfo } from '../services/connectors';
import { formatSize } from '../services/attachments';

/**
 * The board's computer: a Daytona machine that keeps its files between
 * conversations. Bots with the Daytona sandbox, /sh and ▶ all work on it.
 */

interface ComputerPanelProps {
    boardId: string;
    onClose: () => void;
}

const STATE_LABEL: Record<string, string> = {
    started: 'работает',
    starting: 'запускается',
    stopped: 'выключен',
    stopping: 'выключается',
    archived: 'в архиве — проснётся за минуту',
    restoring: 'восстанавливается'
};

const parentOf = (path: string) => path.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

const ComputerPanel: React.FC<ComputerPanelProps> = ({ boardId, onClose }) => {
    const [info, setInfo] = useState<MachineInfo | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(async (label: string, action: () => Promise<MachineInfo | void>) => {
        setBusy(label);
        setError(null);
        try {
            const next = await action();
            if (next) setInfo(next);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    }, []);

    useEffect(() => {
        setInfo(null);
        run('Проверяю…', () => machine(boardId, 'status'));
    }, [boardId, run]);

    const open = (path?: string) => run('Открываю…', () => machine(boardId, 'list', path));

    const download = (name: string) => run('Скачиваю…', async () => {
        const blob = await downloadFromMachine(boardId, join(info!.path!, name));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

    const stop = () => run('Выключаю…', async () => {
        await machine(boardId, 'stop');
        return machine(boardId, 'status');
    });

    const remove = () => {
        if (!window.confirm('Удалить компьютер доски вместе со всеми файлами на нём? Это нельзя отменить.')) return;
        run('Удаляю…', async () => {
            await machine(boardId, 'delete');
            return machine(boardId, 'status');
        });
    };

    const button = 'px-2.5 py-1 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-40';

    return (
        <aside className="absolute md:relative inset-y-0 right-0 z-20 w-80 shrink-0 border-l border-slate-800 bg-slate-900 md:bg-slate-900/30 flex flex-col">
            <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-emerald-300/80 flex items-center justify-between">
                <span>Компьютер доски</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white" title="Закрыть">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs text-slate-300">
                {error && <p className="text-rose-300 break-words">{error}</p>}
                {busy && <p className="text-slate-500 font-mono text-[10px]">{busy}</p>}

                {info && !info.key && (
                    <p className="leading-relaxed text-slate-400">
                        Добавьте ключ Daytona в Настройках — у доски появится свой компьютер: файлы и установленные
                        программы на нём сохраняются между разговорами.
                    </p>
                )}

                {info?.key && !info.exists && (
                    <div className="space-y-2">
                        <p className="leading-relaxed text-slate-400">
                            Компьютера пока нет. Он появится при первой команде <code className="text-cyan-200">/sh</code>,
                            кнопке ▶ или ходе бота с песочницей Daytona — или включите его сейчас.
                        </p>
                        <button disabled={Boolean(busy)} onClick={() => open()} className={`${button} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`}>
                            Включить
                        </button>
                    </div>
                )}

                {info?.key && info.exists && (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <span>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${info.state === 'started' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                {STATE_LABEL[info.state || ''] || info.state}
                            </span>
                            {info.cpu !== undefined && (
                                <span className="text-[10px] font-mono text-slate-500">{info.cpu} CPU · {info.memory} ГБ · {info.disk} ГБ диск</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <button disabled={Boolean(busy)} onClick={() => open(info.path)} className={`${button} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`}>
                                {info.entries ? 'Обновить' : 'Файлы'}
                            </button>
                            {info.state === 'started' && (
                                <button disabled={Boolean(busy)} onClick={stop} className={`${button} border-slate-700 text-slate-400 hover:border-slate-500`}>
                                    Выключить
                                </button>
                            )}
                            <button disabled={Boolean(busy)} onClick={remove} className={`${button} border-rose-500/30 text-rose-300/80 hover:bg-rose-950/30`}>
                                Удалить
                            </button>
                        </div>

                        {info.entries && (
                            <div className="rounded-md border border-slate-800 bg-black/30">
                                <div className="px-2.5 py-1.5 border-b border-slate-800 font-mono text-[10px] text-slate-500 break-all">{info.path}</div>
                                <ul className="max-h-[50vh] overflow-y-auto">
                                    {info.path !== '/' && (
                                        <li>
                                            <button disabled={Boolean(busy)} onClick={() => open(parentOf(info.path!))} className="w-full text-left px-2.5 py-1 hover:bg-slate-800/60 font-mono text-slate-400">↑ ..</button>
                                        </li>
                                    )}
                                    {info.entries.length === 0 && <li className="px-2.5 py-2 text-slate-500">Папка пуста</li>}
                                    {info.entries.map(entry => (
                                        <li key={entry.name}>
                                            <button
                                                disabled={Boolean(busy)}
                                                onClick={() => entry.dir ? open(join(info.path!, entry.name)) : download(entry.name)}
                                                className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1 hover:bg-slate-800/60"
                                                title={entry.dir ? 'Открыть папку' : 'Скачать'}
                                            >
                                                <span className={`truncate font-mono ${entry.dir ? 'text-cyan-200' : 'text-slate-300'}`}>
                                                    {entry.dir ? '▸ ' : ''}{entry.name}
                                                </span>
                                                {!entry.dir && <span className="shrink-0 text-[10px] text-slate-500">{formatSize(entry.size)}</span>}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <p className="text-[10px] leading-relaxed text-slate-500">
                            Без дела компьютер выключается через 15 минут и включается сам при следующей команде. Файлы
                            остаются, пока вы его не удалите. Оплата идёт с вашего аккаунта Daytona.
                        </p>
                    </>
                )}
            </div>
        </aside>
    );
};

export default ComputerPanel;
