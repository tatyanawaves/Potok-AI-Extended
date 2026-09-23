import React, { useState } from 'react';
import { AISettings } from '../types';
import { translations } from '../translations';
import {
    CodeFile, folderPickerAvailable, saveToFolder, downloadFiles, saveToGitHub, safePath
} from '../services/codeSave';

/**
 * Where to put code a bot wrote: a folder on this computer (the system file
 * dialog), plain downloads, the board's cloud storage, or a GitHub repo.
 */

interface CodeSaveDialogProps {
    files: CodeFile[];
    settings: AISettings;
    /** Stores the files as attachments in the current channel, when available. */
    onSaveToBoard?: (files: CodeFile[]) => Promise<void>;
    onClose: () => void;
}

const CodeSaveDialog: React.FC<CodeSaveDialogProps> = ({ files: initial, settings, onSaveToBoard, onClose }) => {
    const t = translations[settings.language] as any;
    const [files, setFiles] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ ok: boolean, text: string } | null>(null);
    const [showGitHub, setShowGitHub] = useState(false);
    const [repo, setRepo] = useState(() => localStorage.getItem('potok_github_repo') || '');
    const [branch, setBranch] = useState('main');
    const [folder, setFolder] = useState('');
    const [message, setMessage] = useState('');

    const run = async (action: () => Promise<string>) => {
        setBusy(true);
        setStatus(null);
        try {
            setStatus({ ok: true, text: await action() });
        } catch (e: any) {
            // Closing the folder dialog is a choice, not an error.
            if (e?.name === 'AbortError') setStatus(null);
            else setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const button = 'w-full py-2 rounded-lg border text-[11px] font-mono uppercase tracking-wider transition-colors disabled:opacity-40';

    return (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
            <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto space-y-3">
                <div className="flex items-start justify-between">
                    <h3 className="text-lg font-bold font-display text-white">{t.saveCode || 'Сохранить код'}</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
                </div>

                <div className="space-y-1">
                    {files.map((file, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <input
                                value={file.path}
                                onChange={(e) => setFiles(prev => prev.map((f, j) => j === i ? { ...f, path: e.target.value } : f))}
                                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs font-mono text-slate-200"
                            />
                            <span className="text-[10px] font-mono text-slate-600 shrink-0">{file.content.split('\n').length} стр.</span>
                        </div>
                    ))}
                </div>

                {folderPickerAvailable() ? (
                    <button disabled={busy} onClick={() => run(async () => `Сохранено в папку «${await saveToFolder(files)}»`)}
                        className={`${button} border-cyan-500/40 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40`}>
                        📁 {t.saveToFolder || 'В папку на компьютере…'}
                    </button>
                ) : (
                    <p className="text-[10px] text-slate-500">{t.noFolderPicker || 'Выбор папки работает в Chrome и Edge; здесь — скачивание файлов.'}</p>
                )}

                <button disabled={busy} onClick={() => run(async () => { downloadFiles(files); return 'Файлы скачаны'; })}
                    className={`${button} border-slate-600 text-slate-300 hover:bg-slate-800`}>
                    ⬇ {t.download || 'Скачать'}
                </button>

                {onSaveToBoard && (
                    <button disabled={busy} onClick={() => run(async () => { await onSaveToBoard(files); return 'Файлы сохранены в облаке доски — они в канале'; })}
                        className={`${button} border-indigo-500/40 text-indigo-200 hover:bg-indigo-950/40`}>
                        ☁ {t.saveToBoard || 'В облако доски'}
                    </button>
                )}

                <button disabled={busy} onClick={() => setShowGitHub(v => !v)}
                    className={`${button} border-slate-600 text-slate-300 hover:bg-slate-800`}>
                    GitHub
                </button>

                {showGitHub && (
                    <div className="space-y-2 p-3 rounded-lg border border-slate-800">
                        {!settings.githubToken ? (
                            <p className="text-[11px] text-amber-300/80 leading-relaxed">
                                {t.githubTokenMissing || 'Добавьте токен GitHub в Настройках (fine-grained, права Contents: Read and write на нужный репозиторий). Он хранится только в этом браузере.'}
                            </p>
                        ) : (
                            <>
                                <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200" />
                                <div className="flex gap-2">
                                    <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main"
                                        className="w-1/3 bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200" />
                                    <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={t.folderInRepo || 'папка в репозитории'}
                                        className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200" />
                                </div>
                                <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.commitMessage || 'Сообщение коммита'}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-200" />
                                <button disabled={busy || !repo.trim()}
                                    onClick={() => run(async () => {
                                        localStorage.setItem('potok_github_repo', repo.trim());
                                        const url = await saveToGitHub(files.map(f => ({ ...f, path: safePath(f.path) })),
                                            { repo, branch, folder, message }, settings.githubToken!);
                                        return `Закоммичено: ${url}`;
                                    })}
                                    className={`${button} border-emerald-500/40 bg-emerald-950/30 text-emerald-200`}>
                                    {t.commit || 'Закоммитить'}
                                </button>
                            </>
                        )}
                    </div>
                )}

                {busy && <p className="text-[11px] text-slate-500">…</p>}
                {status && <p className={`text-[11px] break-all ${status.ok ? 'text-emerald-400' : 'text-rose-300'}`}>{status.text}</p>}
            </div>
        </div>
    );
};

export default CodeSaveDialog;
