import React, { useState, useEffect, useCallback, useRef } from 'react';
import { translations } from '../translations';
import { Language } from '../types';
import {
    searchApps, listConnectedAccounts, startAccountConnection,
    CatalogApp, ConnectedAccount
} from '../services/pipedream';

interface ToolCatalogProps {
    language: Language;
    onClose: () => void;
    /** Called when the user picks a connected service to give a bot. */
    onPick?: (appSlug: string, appName: string) => void;
}

/**
 * Browsable catalogue of Pipedream services.
 *
 * Replaces typing raw slugs like "google_sheets": people recognise a service by
 * its logo and name, not by the identifier Pipedream happens to use for it.
 */
const ToolCatalog: React.FC<ToolCatalogProps> = ({ language, onClose, onPick }) => {
    const t = translations[language] as any;

    const [query, setQuery] = useState('');
    const [apps, setApps] = useState<CatalogApp[]>([]);
    const [connected, setConnected] = useState<ConnectedAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const searchTimer = useRef<number | null>(null);

    const refreshConnected = useCallback(async () => {
        try {
            setConnected(await listConnectedAccounts());
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    const runSearch = useCallback(async (value: string) => {
        setLoading(true);
        setError(null);
        try {
            setApps(await searchApps(value));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshConnected();
        runSearch('');
    }, [refreshConnected, runSearch]);

    // Debounced so typing doesn't fire a request per keystroke.
    useEffect(() => {
        if (searchTimer.current) window.clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(() => runSearch(query), 350);

        return () => {
            if (searchTimer.current) window.clearTimeout(searchTimer.current);
        };
    }, [query, runSearch]);

    const connectedSlugs = new Set(connected.map(a => a.appSlug).filter(Boolean) as string[]);

    const handleConnect = async (app: CatalogApp) => {
        setConnecting(app.slug);
        setError(null);
        try {
            await startAccountConnection(app.slug);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setConnecting(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">

                <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-lg font-bold font-display text-white">
                            {t.toolCatalog || 'Инструменты'}
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {t.toolCatalogHint || 'Подключите сервис, чтобы бот получил его инструменты'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-5 pb-3 shrink-0">
                    <input
                        autoFocus
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t.searchServices || 'Поиск: slack, notion, таблицы, почта…'}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
                    />

                    {connected.length > 0 && (
                        <div className="mt-3">
                            <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600">
                                {t.alreadyConnected || 'Уже подключено'}
                            </span>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {connected.map(account => (
                                    <button
                                        key={account.id}
                                        onClick={() => account.appSlug && onPick?.(account.appSlug, account.appName || account.appSlug)}
                                        disabled={!onPick}
                                        className={`text-[11px] px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-950/30 text-emerald-300 ${onPick ? 'hover:bg-emerald-900/40 cursor-pointer' : 'cursor-default'}`}
                                    >
                                        ✓ {account.appName || account.appSlug}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs shrink-0">
                        {error}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
                    {loading && apps.length === 0 ? (
                        <p className="text-center text-slate-600 text-xs py-10">
                            {t.loading || 'Загрузка…'}
                        </p>
                    ) : apps.length === 0 ? (
                        <p className="text-center text-slate-600 text-xs py-10">
                            {t.nothingFound || 'Ничего не найдено'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {apps.map(app => {
                                const isConnected = connectedSlugs.has(app.slug);

                                return (
                                    <div
                                        key={app.slug}
                                        className={`flex items-start space-x-3 p-3 rounded-xl border transition-all ${isConnected
                                            ? 'border-emerald-500/30 bg-emerald-950/10'
                                            : 'border-slate-800 bg-slate-950/50 hover:border-slate-600'
                                            }`}
                                    >
                                        {app.imgSrc ? (
                                            <img
                                                src={app.imgSrc}
                                                alt=""
                                                className="w-8 h-8 rounded-md shrink-0 bg-white/5 object-contain"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 rounded-md shrink-0 bg-slate-800 flex items-center justify-center text-slate-500 text-xs font-mono">
                                                {app.name.charAt(0)}
                                            </div>
                                        )}

                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm text-slate-200 truncate">{app.name}</div>
                                            <p className="text-[10px] text-slate-600 line-clamp-2 leading-relaxed mt-0.5">
                                                {app.description || app.categories.join(', ')}
                                            </p>

                                            <div className="mt-2">
                                                {isConnected ? (
                                                    <button
                                                        onClick={() => onPick?.(app.slug, app.name)}
                                                        disabled={!onPick}
                                                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/30 bg-emerald-950/30 text-emerald-300 ${onPick ? 'hover:bg-emerald-900/40' : 'cursor-default'}`}
                                                    >
                                                        {onPick ? (t.use || 'выбрать') : (t.connected || 'подключено')}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleConnect(app)}
                                                        disabled={connecting === app.slug}
                                                        className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-indigo-500/30 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40 transition-colors disabled:opacity-40"
                                                    >
                                                        {connecting === app.slug ? '...' : (t.connect || 'подключить')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-800 flex items-center justify-between shrink-0">
                    <span className="text-[10px] text-slate-600">
                        {t.connectOpensTab || 'Подключение откроется в новой вкладке'}
                    </span>
                    <button
                        onClick={refreshConnected}
                        className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        {t.refresh || 'обновить'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ToolCatalog;
