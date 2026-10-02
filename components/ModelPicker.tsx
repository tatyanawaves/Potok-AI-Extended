import React, { useEffect, useMemo, useRef, useState } from 'react';
import { openRouterFreeModels, FreeModel } from '../services/llm';

/**
 * A model field with OpenRouter's current free models to pick from: name,
 * context size, and whether the model can call tools or see images. Any
 * other model name can still be typed in.
 */

interface ModelPickerProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    language: string;
    /** Only offer models that can call tools (for bots with tools). */
    toolsOnly?: boolean;
    className?: string;
}

const TEXT = {
    ru: { choose: 'Бесплатные модели', search: 'Поиск модели…', tools: 'инструменты', vision: 'картинки', none: 'Ничего не нашлось', loading: 'Загружаю список OpenRouter…', unavailable: 'Список OpenRouter недоступен — впишите модель вручную' },
    en: { choose: 'Free models', search: 'Search models…', tools: 'tools', vision: 'images', none: 'Nothing found', loading: 'Loading OpenRouter models…', unavailable: 'OpenRouter list unavailable — type a model name' },
    kk: { choose: 'Тегін модельдер', search: 'Модельді іздеу…', tools: 'құралдар', vision: 'суреттер', none: 'Ештеңе табылмады', loading: 'OpenRouter тізімі жүктелуде…', unavailable: 'OpenRouter тізімі қолжетімсіз — модель атын жазыңыз' }
};

const contextLabel = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`;

const ModelPicker: React.FC<ModelPickerProps> = ({ value, onChange, placeholder, language, toolsOnly, className }) => {
    const tx = TEXT[language as keyof typeof TEXT] || TEXT.ru;
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<FreeModel[] | null>(null);
    const [query, setQuery] = useState('');
    const box = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open || models) return;
        openRouterFreeModels().then(setModels);
    }, [open, models]);

    // Closes when the person clicks elsewhere.
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (models || [])
            .filter(m => !toolsOnly || m.tools)
            .filter(m => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    }, [models, query, toolsOnly]);

    return (
        <div ref={box} className="relative">
            <div className="flex gap-1.5">
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={className || 'w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm'}
                />
                <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    className="shrink-0 px-2.5 rounded-lg border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/50 text-xs"
                    title={tx.choose}
                    aria-expanded={open}
                >
                    ▾
                </button>
            </div>

            {open && (
                <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl">
                    <div className="sticky top-0 bg-slate-950 p-2 border-b border-slate-800">
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={tx.search}
                            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        />
                    </div>
                    {models === null && <p className="px-3 py-2 text-[11px] text-slate-500">{tx.loading}</p>}
                    {models !== null && models.length === 0 && <p className="px-3 py-2 text-[11px] text-amber-300/90">{tx.unavailable}</p>}
                    {models !== null && models.length > 0 && shown.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-500">{tx.none}</p>}
                    <ul>
                        {shown.map(m => (
                            <li key={m.id}>
                                <button
                                    type="button"
                                    onClick={() => { onChange(m.id); setOpen(false); setQuery(''); }}
                                    className={`w-full text-left px-3 py-1.5 hover:bg-slate-800/70 ${m.id === value ? 'bg-cyan-950/30' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-slate-200 truncate">{m.name}</span>
                                        <span className="shrink-0 text-[10px] font-mono text-slate-500">{contextLabel(m.contextLength)}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[10px] font-mono text-slate-500 truncate">{m.id}</span>
                                        {m.tools && <span className="shrink-0 text-[9px] px-1 rounded bg-emerald-950/50 text-emerald-300/90 border border-emerald-500/20">{tx.tools}</span>}
                                        {m.vision && <span className="shrink-0 text-[9px] px-1 rounded bg-indigo-950/50 text-indigo-300/90 border border-indigo-500/20">{tx.vision}</span>}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default ModelPicker;
