import React, { useCallback, useEffect, useRef, useState } from 'react';
import { machine, downloadFromMachine, previewPort, MachineInfo } from '../services/connectors';
import { formatSize } from '../services/attachments';

/**
 * The board's computer: a Daytona machine that keeps its files between
 * conversations. Bots with the Daytona sandbox, /sh and ▶ all work on it.
 */

interface ComputerPanelProps {
    boardId: string;
    language: string;
    /** How many terminal blocks the channel has; a new one means the machine changed. */
    activity: number;
    onClose: () => void;
}

const TEXT = {
    ru: {
        title: 'Компьютер доски', close: 'Закрыть',
        states: { started: 'работает', starting: 'запускается', stopped: 'выключен', stopping: 'выключается', archived: 'в архиве — проснётся за минуту', restoring: 'восстанавливается' } as Record<string, string>,
        checking: 'Проверяю…', opening: 'Открываю…', downloading: 'Скачиваю…', stopping: 'Выключаю…', deleting: 'Удаляю…', publishing: 'Открываю доступ…',
        deleteConfirm: 'Удалить компьютер доски вместе со всеми файлами на нём? Это нельзя отменить.',
        noKey: 'Добавьте ключ Daytona в Настройках — у доски появится свой компьютер: файлы и установленные программы на нём сохраняются между разговорами.',
        noMachine: ['Компьютера пока нет. Он появится при первой команде', 'кнопке ▶ или ходе бота с песочницей Daytona — или включите его сейчас.'],
        turnOn: 'Включить', refresh: 'Обновить', files: 'Файлы', stop: 'Выключить', remove: 'Удалить',
        gb: 'ГБ', disk: 'диск', emptyFolder: 'Папка пуста', openFolder: 'Открыть папку', download: 'Скачать',
        footer: 'Без дела компьютер выключается через 15 минут и включается сам при следующей команде. Файлы остаются, пока вы его не удалите. Оплата идёт с вашего аккаунта Daytona.',
        preview: 'Предпросмотр сайта', port: 'порт', open: 'Открыть',
        previewHint: 'Если бот или вы запустили сайт на этом порту (на 0.0.0.0), он откроется по ссылке.',
        publicWarning: 'Доступ по ссылке открыт: любой, у кого она есть, видит запущенные на машине сайты.',
        unpublish: 'Закрыть доступ',
        previewConfirm: 'Открыть доступ к машине по ссылке? Любой, у кого будет ссылка, сможет открыть сайты, запущенные на ней, пока вы не закроете доступ.'
    },
    en: {
        title: "Board's computer", close: 'Close',
        states: { started: 'running', starting: 'starting', stopped: 'off', stopping: 'turning off', archived: 'archived — wakes in a minute', restoring: 'restoring' } as Record<string, string>,
        checking: 'Checking…', opening: 'Opening…', downloading: 'Downloading…', stopping: 'Turning off…', deleting: 'Deleting…', publishing: 'Opening access…',
        deleteConfirm: "Delete the board's computer with every file on it? This cannot be undone.",
        noKey: 'Add a Daytona key in Settings and the board gets a computer of its own: files and installed programs on it stay between conversations.',
        noMachine: ['No computer yet. It appears with the first', 'command, ▶, or a turn of a bot with the Daytona sandbox — or turn it on now.'],
        turnOn: 'Turn on', refresh: 'Refresh', files: 'Files', stop: 'Turn off', remove: 'Delete',
        gb: 'GB', disk: 'disk', emptyFolder: 'Empty folder', openFolder: 'Open folder', download: 'Download',
        footer: 'When idle the computer turns off after 15 minutes and back on by itself at the next command. Files stay until you delete it. It is billed to your Daytona account.',
        preview: 'Site preview', port: 'port', open: 'Open',
        previewHint: 'If a bot or you started a site on this port (on 0.0.0.0), it opens through a link.',
        publicWarning: 'Link access is on: anyone holding a link can see sites running on the machine.',
        unpublish: 'Close access',
        previewConfirm: 'Open the machine to link access? Anyone with the link will be able to open sites running on it until you close access.'
    },
    kk: {
        title: 'Тақта компьютері', close: 'Жабу',
        states: { started: 'жұмыс істеп тұр', starting: 'іске қосылып жатыр', stopped: 'өшірулі', stopping: 'өшіп жатыр', archived: 'мұрағатта — бір минутта оянады', restoring: 'қалпына келтірілуде' } as Record<string, string>,
        checking: 'Тексеріп жатырмын…', opening: 'Ашып жатырмын…', downloading: 'Жүктеп жатырмын…', stopping: 'Өшіріп жатырмын…', deleting: 'Жойып жатырмын…', publishing: 'Қолжетімділікті ашып жатырмын…',
        deleteConfirm: 'Тақта компьютерін ондағы барлық файлдармен бірге жою керек пе? Мұны қайтару мүмкін емес.',
        noKey: 'Баптауларда Daytona кілтін қосыңыз — тақтаның өз компьютері пайда болады: ондағы файлдар мен орнатылған бағдарламалар әңгімелер арасында сақталады.',
        noMachine: ['Әзірге компьютер жоқ. Ол алғашқы', 'командасында, ▶ батырмасында немесе Daytona құмсалғышы бар боттың кезегінде пайда болады — не оны қазір қосыңыз.'],
        turnOn: 'Қосу', refresh: 'Жаңарту', files: 'Файлдар', stop: 'Өшіру', remove: 'Жою',
        gb: 'ГБ', disk: 'диск', emptyFolder: 'Қалта бос', openFolder: 'Қалтаны ашу', download: 'Жүктеп алу',
        footer: 'Бос тұрса, компьютер 15 минуттан кейін өшеді және келесі командада өзі қосылады. Файлдар сіз жоймайынша сақталады. Төлем сіздің Daytona аккаунтыңыздан алынады.',
        preview: 'Сайтты алдын ала қарау', port: 'порт', open: 'Ашу',
        previewHint: 'Егер бот немесе сіз осы портта (0.0.0.0-де) сайт іске қоссаңыз, ол сілтеме арқылы ашылады.',
        publicWarning: 'Сілтеме арқылы қолжетімділік ашық: сілтемесі бар кез келген адам машинада іске қосылған сайттарды көреді.',
        unpublish: 'Қолжетімділікті жабу',
        previewConfirm: 'Машинаға сілтеме арқылы қолжетімділікті ашу керек пе? Сілтемесі бар кез келген адам, сіз жапқанша, онда іске қосылған сайттарды аша алады.'
    }
};

const parentOf = (path: string) => path.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

const ComputerPanel: React.FC<ComputerPanelProps> = ({ boardId, language, activity, onClose }) => {
    const tx = TEXT[language as keyof typeof TEXT] || TEXT.ru;
    const [info, setInfo] = useState<MachineInfo | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [port, setPort] = useState('8000');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const run = useCallback(async (label: string, action: () => Promise<MachineInfo | void>) => {
        setBusy(label);
        setError(null);
        try {
            const next = await action();
            if (next) setInfo(previous => ({ ...previous, ...next }));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    }, []);

    useEffect(() => {
        setInfo(null);
        setPreviewUrl(null);
        run(tx.checking, () => machine(boardId, 'status'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardId, run]);

    const open = (path?: string) => run(tx.opening, () => machine(boardId, 'list', path));

    // Something just ran: the machine may have been created, and its files changed.
    const seen = useRef(activity);
    useEffect(() => {
        if (activity === seen.current) return;
        seen.current = activity;
        if (info?.entries) open(info.path);
        else run(tx.checking, () => machine(boardId, 'status'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activity]);

    const download = (name: string) => run(tx.downloading, async () => {
        const blob = await downloadFromMachine(boardId, join(info!.path!, name));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

    const stop = () => run(tx.stopping, async () => {
        await machine(boardId, 'stop');
        return machine(boardId, 'status');
    });

    const remove = () => {
        if (!window.confirm(tx.deleteConfirm)) return;
        setPreviewUrl(null);
        run(tx.deleting, async () => {
            await machine(boardId, 'delete');
            return { key: true, exists: false, entries: undefined, public: false };
        });
    };

    const preview = () => {
        if (!info?.public && !window.confirm(tx.previewConfirm)) return;
        run(tx.publishing, async () => {
            setPreviewUrl(await previewPort(boardId, Number(port)));
            return { key: true, exists: true, public: true };
        });
    };

    const unpublish = () => run(tx.checking, async () => {
        await machine(boardId, 'unpublish');
        setPreviewUrl(null);
        return { key: true, exists: true, public: false };
    });

    const button = 'px-2.5 py-1 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-40';

    return (
        <aside className="absolute lg:relative inset-y-0 right-0 z-20 w-full max-w-xs md:max-w-none md:w-80 shrink-0 border-l border-slate-800 bg-slate-900 lg:bg-slate-900/30 flex flex-col shadow-2xl lg:shadow-none">
            <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-emerald-300/80 flex items-center justify-between">
                <span>{tx.title}</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white" title={tx.close}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs text-slate-300">
                {error && <p className="text-rose-300 break-words">{error}</p>}
                {busy && <p className="text-slate-500 font-mono text-[10px]">{busy}</p>}

                {info && !info.key && <p className="leading-relaxed text-slate-400">{tx.noKey}</p>}

                {info?.key && !info.exists && (
                    <div className="space-y-2">
                        <p className="leading-relaxed text-slate-400">
                            {tx.noMachine[0]} <code className="text-cyan-200">/sh</code>, {tx.noMachine[1]}
                        </p>
                        <button disabled={Boolean(busy)} onClick={() => open()} className={`${button} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`}>
                            {tx.turnOn}
                        </button>
                    </div>
                )}

                {info?.key && info.exists && (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <span>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${info.state === 'started' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                {tx.states[info.state || ''] || info.state}
                            </span>
                            {info.cpu !== undefined && (
                                <span className="text-[10px] font-mono text-slate-500">{info.cpu} CPU · {info.memory} {tx.gb} · {info.disk} {tx.gb} {tx.disk}</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <button disabled={Boolean(busy)} onClick={() => open(info.path)} className={`${button} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`}>
                                {info.entries ? tx.refresh : tx.files}
                            </button>
                            {info.state === 'started' && (
                                <button disabled={Boolean(busy)} onClick={stop} className={`${button} border-slate-700 text-slate-400 hover:border-slate-500`}>
                                    {tx.stop}
                                </button>
                            )}
                            <button disabled={Boolean(busy)} onClick={remove} className={`${button} border-rose-500/30 text-rose-300/80 hover:bg-rose-950/30`}>
                                {tx.remove}
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
                                    {info.entries.length === 0 && <li className="px-2.5 py-2 text-slate-500">{tx.emptyFolder}</li>}
                                    {info.entries.map(entry => (
                                        <li key={entry.name}>
                                            <button
                                                disabled={Boolean(busy)}
                                                onClick={() => entry.dir ? open(join(info.path!, entry.name)) : download(entry.name)}
                                                className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1 hover:bg-slate-800/60"
                                                title={entry.dir ? tx.openFolder : tx.download}
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

                        <section className="space-y-1.5 pt-1">
                            <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-500">{tx.preview}</h4>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-slate-500">{tx.port}</span>
                                <input
                                    value={port}
                                    onChange={e => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                    inputMode="numeric"
                                    className="w-20 bg-slate-950 border border-slate-700 rounded-md px-2 py-1 font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                />
                                <button disabled={Boolean(busy) || !port} onClick={preview} className={`${button} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`}>
                                    {tx.open}
                                </button>
                            </div>
                            <p className="text-[10px] leading-relaxed text-slate-500">{tx.previewHint}</p>
                            {previewUrl && (
                                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="block break-all font-mono text-[11px] text-cyan-300 hover:underline">
                                    {previewUrl} ↗
                                </a>
                            )}
                            {info.public && (
                                <div className="rounded-md border border-amber-500/30 bg-amber-950/20 px-2.5 py-2 space-y-1.5">
                                    <p className="text-[10px] leading-relaxed text-amber-200/90">{tx.publicWarning}</p>
                                    <button disabled={Boolean(busy)} onClick={unpublish} className={`${button} border-amber-500/40 text-amber-200 hover:bg-amber-950/40`}>
                                        {tx.unpublish}
                                    </button>
                                </div>
                            )}
                        </section>

                        <p className="text-[10px] leading-relaxed text-slate-500">{tx.footer}</p>
                    </>
                )}
            </div>
        </aside>
    );
};

export default ComputerPanel;
