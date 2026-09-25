import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { GUIDES, Guide, guideById } from '../services/guides';

/**
 * Learning mode: a help centre (🎓 in the header) with a guide per feature,
 * and — while "show hints" is on — a "?" next to each feature that opens its
 * guide. The guides themselves are data, in services/guides.
 */

interface LearningApi {
    hintsOn: boolean;
    setHintsOn: (on: boolean) => void;
    openGuide: (id: string) => void;
    openCenter: () => void;
}

const HINTS_KEY = 'potok_learning_hints';
const WELCOMED_KEY = 'potok_learning_welcomed';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

const LearningContext = createContext<LearningApi>({
    hintsOn: false, setHintsOn: () => { }, openGuide: () => { }, openCenter: () => { }
});

export const useLearning = () => useContext(LearningContext);

export const LearningProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // On for newcomers: the hints are most useful before anything is familiar.
    const [hintsOn, setHints] = useState(() => read(HINTS_KEY) !== '0');
    const [view, setView] = useState<{ kind: 'guide', id: string } | { kind: 'center' } | null>(null);

    const setHintsOn = useCallback((on: boolean) => { setHints(on); write(HINTS_KEY, on ? '1' : '0'); }, []);
    const openGuide = useCallback((id: string) => setView({ kind: 'guide', id }), []);
    const openCenter = useCallback(() => setView({ kind: 'center' }), []);

    // The first visit opens the getting-started guide once.
    useEffect(() => {
        if (!read(WELCOMED_KEY)) {
            write(WELCOMED_KEY, '1');
            setView({ kind: 'guide', id: 'start' });
        }
    }, []);

    const guide = view?.kind === 'guide' ? guideById(view.id) : undefined;

    return (
        <LearningContext.Provider value={{ hintsOn, setHintsOn, openGuide, openCenter }}>
            {children}
            {view?.kind === 'center' && (
                <Modal onClose={() => setView(null)}>
                    <h3 className="text-lg font-bold font-display text-white">🎓 Обучение</h3>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={hintsOn} onChange={(e) => setHintsOn(e.target.checked)} className="accent-cyan-500" />
                        Показывать подсказки «?» рядом с функциями
                    </label>
                    <div className="grid grid-cols-1 gap-1.5">
                        {GUIDES.map(g => (
                            <button key={g.id} onClick={() => openGuide(g.id)}
                                className="text-left px-3 py-2 rounded-lg border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/50">
                                <span className="text-sm text-slate-200 block">{g.title}</span>
                                <span className="text-[11px] text-slate-500 block">{g.summary}</span>
                            </button>
                        ))}
                    </div>
                </Modal>
            )}
            {guide && <GuideView guide={guide} onBack={() => setView({ kind: 'center' })} onClose={() => setView(null)} />}
        </LearningContext.Provider>
    );
};

const Modal: React.FC<{ onClose: () => void, children: React.ReactNode }> = ({ onClose, children }) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
                className="relative bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl max-w-md w-full p-5 max-h-[88vh] overflow-y-auto space-y-3">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white" aria-label="Закрыть">✕</button>
                {children}
            </div>
        </div>
    );
};

const GuideView: React.FC<{ guide: Guide, onBack: () => void, onClose: () => void }> = ({ guide, onBack, onClose }) => (
    <Modal onClose={onClose}>
        <button onClick={onBack} className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300">← Все разделы</button>
        <h3 className="text-lg font-bold font-display text-white pr-6">{guide.title}</h3>
        <p className="text-xs text-slate-400 leading-relaxed">{guide.summary}</p>
        <ol className="space-y-2">
            {guide.steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-slate-200 leading-relaxed">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 text-[10px] flex items-center justify-center">{i + 1}</span>
                    <span className="break-words min-w-0">{step}</span>
                </li>
            ))}
        </ol>
        {guide.links?.length ? (
            <div className="space-y-1">
                <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500">Где взять / подключить</div>
                {guide.links.map(link => (
                    <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
                        className="block text-[12px] text-cyan-300 hover:text-cyan-200 underline decoration-cyan-500/40 break-words">
                        ↗ {link.label}
                    </a>
                ))}
            </div>
        ) : null}
        {guide.notes?.map((note, i) => (
            <p key={i} className="text-[11px] text-amber-200/80 leading-relaxed border-l-2 border-amber-500/40 pl-2">{note}</p>
        ))}
    </Modal>
);

/**
 * The "?" beside a feature. Shown while hints are on, or always when `always`
 * is set — used next to key fields, where "where do I get this" is the first
 * question anyone has.
 */
export const Hint: React.FC<{ id: string, always?: boolean, className?: string }> = ({ id, always, className = '' }) => {
    const { hintsOn, openGuide } = useLearning();
    if (!hintsOn && !always) return null;
    return (
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openGuide(id); }}
            title="Как это работает и где взять ключ"
            aria-label={`Обучение: ${guideById(id)?.title || id}`}
            className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-cyan-500/50 text-cyan-300 text-[9px] font-bold leading-none hover:bg-cyan-900/40 align-middle shrink-0 ${className}`}>
            ?
        </button>
    );
};
