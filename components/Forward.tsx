import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AISettings } from '../types';
import { translations } from '../translations';
import { auth, searchProfiles } from '../services/firebase';
import { FollowedProfile } from '../services/social';
import { Hint } from './Learning';
import {
    ForwardPayload, ForwardTarget, ForwardDestinations, ForwardResult,
    loadForwardDestinations, forwardItem, targetKey, targetLabel, describeOrigin, isEmptyPayload
} from '../services/forward';

/**
 * Forwarding from anywhere to anywhere.
 *
 * One dialog, mounted once at the top of the app, opened through context by
 * whatever is being forwarded — a post, a comment, a channel message, a direct
 * message. The places that offer "forward" only have to describe the item;
 * where it can go is decided here, the same way for all of them.
 */

type OpenForward = (payload: ForwardPayload) => void;

const ForwardContext = createContext<OpenForward | null>(null);

/** Opens the forward dialog; a no-op outside the provider (e.g. in tests). */
export const useForward = (): OpenForward => useContext(ForwardContext) || (() => { });

interface ForwardProviderProps {
    settings: AISettings;
    followedProfiles: FollowedProfile[];
    children: React.ReactNode;
}

export const ForwardProvider: React.FC<ForwardProviderProps> = ({ settings, followedProfiles, children }) => {
    const [payload, setPayload] = useState<ForwardPayload | null>(null);
    const [sentTo, setSentTo] = useState<number | null>(null);
    const open = useCallback<OpenForward>(p => setPayload(p), []);
    const t = translations[settings.language] as any;

    // The dialog closes on success, so something has to say it worked.
    useEffect(() => {
        if (sentTo === null) return;
        const timer = window.setTimeout(() => setSentTo(null), 2500);
        return () => window.clearTimeout(timer);
    }, [sentTo]);

    return (
        <ForwardContext.Provider value={open}>
            {children}
            {payload && (
                <ForwardDialog
                    payload={payload}
                    settings={settings}
                    followedProfiles={followedProfiles}
                    onClose={() => setPayload(null)}
                    onSent={count => { setPayload(null); setSentTo(count); }}
                />
            )}
            {sentTo !== null && (
                <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[195] px-4 py-2 rounded-xl bg-emerald-900/90 border border-emerald-500/40 text-emerald-100 text-xs font-mono shadow-2xl">
                    ✓ {t.forwarded || 'Переслано'}{sentTo > 1 ? ` · ${sentTo}` : ''}
                </div>
            )}
        </ForwardContext.Provider>
    );
};

/** The small "forward" arrow shown next to anything forwardable. */
export const ForwardButton: React.FC<{
    payload: () => ForwardPayload;
    title?: string;
    className?: string;
}> = ({ payload, title = 'Переслать', className = '' }) => {
    const forward = useForward();

    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); forward(payload()); }}
            title={title}
            aria-label={title}
            className={`text-slate-500 hover:text-cyan-400 transition-colors ${className}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M20 12H9a5 5 0 00-5 5v2" />
            </svg>
        </button>
    );
};

/** The "forwarded from" line on a copy. */
export const ForwardedLabel: React.FC<{ origin: ForwardPayload['origin'], language: string }> = ({ origin, language }) => {
    const t = translations[language as 'ru' | 'en' | 'kk'] as any;
    return (
        <div className="flex items-center gap-1 text-[10px] font-mono text-cyan-500/80 mb-1">
            <span aria-hidden="true">↪</span>
            <span className="truncate">{describeOrigin(origin, t.forwardedFrom || 'Переслано от')}</span>
        </div>
    );
};

interface ForwardDialogProps {
    payload: ForwardPayload;
    settings: AISettings;
    followedProfiles: FollowedProfile[];
    onClose: () => void;
    onSent: (count: number) => void;
}

const ForwardDialog: React.FC<ForwardDialogProps> = ({ payload, settings, followedProfiles, onClose, onSent }) => {
    const t = translations[settings.language] as any;
    const uid = auth.currentUser?.uid;

    const [destinations, setDestinations] = useState<ForwardDestinations | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Map<string, ForwardTarget>>(new Map());
    const [filter, setFilter] = useState('');
    const [people, setPeople] = useState<Array<Record<string, any>>>([]);
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState<ForwardResult[] | null>(null);

    useEffect(() => {
        if (!uid) return;
        loadForwardDestinations(uid)
            .then(setDestinations)
            .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
    }, [uid]);

    // People you have no thread with yet are found by name.
    useEffect(() => {
        const term = filter.trim();
        if (!term) { setPeople([]); return; }

        const timer = window.setTimeout(() => {
            searchProfiles(term, uid).then(setPeople).catch(() => setPeople([]));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [filter, uid]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, sending]);

    const needle = filter.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

    const toggle = (target: ForwardTarget) => {
        const key = targetKey(target);
        setSelected(prev => {
            const next = new Map(prev);
            if (next.has(key)) next.delete(key); else next.set(key, target);
            return next;
        });
    };

    // A person reached through search who already has a thread goes to that
    // thread, not to a second one.
    const conversationWith = useMemo(() => {
        const map = new Map<string, string>();
        destinations?.conversations.forEach(c => map.set(c.otherId, c.id));
        return map;
    }, [destinations]);

    const personTarget = (personUid: string, name: string): ForwardTarget => {
        const existing = conversationWith.get(personUid);
        return existing
            ? { kind: 'conversation', conversationId: existing, label: name }
            : { kind: 'person', uid: personUid, name };
    };

    const contacts = useMemo(() => {
        const seen = new Set<string>();
        const list: Array<{ uid: string, name: string }> = [];
        destinations?.conversations.forEach(c => {
            if (c.otherId && !seen.has(c.otherId)) { seen.add(c.otherId); list.push({ uid: c.otherId, name: c.name }); }
        });
        followedProfiles.forEach(p => {
            if (!seen.has(p.uid) && p.uid !== uid) { seen.add(p.uid); list.push({ uid: p.uid, name: p.name }); }
        });
        people.forEach(p => {
            if (!seen.has(p.uid)) { seen.add(p.uid); list.push({ uid: p.uid, name: p.agentName }); }
        });
        return list.filter(c => matches(c.name));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [destinations, followedProfiles, people, needle, uid]);

    const handleSend = async () => {
        if (!uid || selected.size === 0 || sending) return;

        setSending(true);
        try {
            const outcome = await forwardItem(payload, [...selected.values()], {
                uid,
                name: settings.agentName || 'User',
                userType: settings.userType
            }, comment);

            if (outcome.every(r => r.ok)) {
                onSent(outcome.length);
                return;
            }
            setResults(outcome);
            // Keep only what failed selected, so "retry" is one click.
            setSelected(prev => new Map([...prev].filter(([key]) => outcome.some(r => r.key === key && !r.ok))));
        } finally {
            setSending(false);
        }
    };

    // A plain function, not a component: declared inside the dialog, a
    // component would be a new type on every render and remount each row.
    const renderRow = (target: ForwardTarget, label: string, hint?: string) => {
        const key = targetKey(target);
        const picked = selected.has(key);
        const failed = results?.find(r => r.key === key && !r.ok);

        return (
            <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={picked}
                aria-label={label}
                onClick={() => toggle(target)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${picked
                    ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-100'
                    : 'border-transparent text-slate-300 hover:bg-slate-800/60'}`}
            >
                <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${picked ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'border-slate-600'}`}>
                    {picked ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="text-sm truncate block">{label}</span>
                    {(failed || hint) && (
                        <span className={`text-[10px] truncate block ${failed ? 'text-rose-400' : 'text-slate-600'}`}>
                            {failed ? failed.error : hint}
                        </span>
                    )}
                </span>
            </button>
        );
    };

    const feedTarget: ForwardTarget = { kind: 'feed' };
    const sendsAttachmentsToFeed = selected.has('feed') && Boolean(payload.attachments?.length);
    const preview = payload.text.trim() || (payload.attachments?.length ? `📎 ${payload.attachments.map(a => a.name).join(', ')}` : payload.imageUrl || '');

    return (
        <div
            className="fixed inset-0 z-[190] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => { if (!sending) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t.forward || 'Переслать'}
                onClick={(e) => e.stopPropagation()}
                className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full flex flex-col max-h-[88vh]"
            >
                <div className="p-5 pb-3 border-b border-slate-800 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-bold font-display text-white">{t.forward || 'Переслать'} <Hint id="forward" /></h3>
                        <button onClick={onClose} disabled={sending} className="text-slate-500 hover:text-white">✕</button>
                    </div>
                    <div className="mt-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-mono text-slate-500 truncate">{describeOrigin(payload.origin, t.from || 'От')}</div>
                        <p className="text-xs text-slate-300 line-clamp-3 whitespace-pre-wrap break-words mt-0.5">{preview}</p>
                    </div>
                    <input
                        autoFocus
                        type="search"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={t.forwardSearch || 'Канал, доска или человек…'}
                        className="mt-3 w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-4">
                    {matches(t.feed || 'Лента') || matches('лента') ? (
                        <section>
                            <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-600 mb-1">{t.feedSection || 'Лента'}</h4>
                            {renderRow(feedTarget, t.feedTitle || targetLabel(feedTarget), t.feedHint || 'Опубликовать от своего имени для всех')}
                        </section>
                    ) : null}

                    {loadError && <p className="text-xs text-rose-400">{loadError}</p>}
                    {!destinations && !loadError && (
                        <p className="text-[11px] text-slate-600 text-center py-4">{t.loading || 'Загрузка…'}</p>
                    )}

                    {destinations && destinations.boards.map(board => {
                        const channels = board.channels.filter(c => matches(c.name) || matches(board.name));
                        if (channels.length === 0) return null;
                        return (
                            <section key={board.id}>
                                <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-600 mb-1 truncate">
                                    {t.board || 'Доска'} · {board.name}
                                </h4>
                                <div className="space-y-0.5">
                                    {channels.map(channel => renderRow(
                                        { kind: 'channel', boardId: board.id, channelId: channel.id, label: `#${channel.name} · ${board.name}` },
                                        `#${channel.name}`
                                    ))}
                                </div>
                            </section>
                        );
                    })}

                    {destinations && contacts.length > 0 && (
                        <section>
                            <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-600 mb-1">
                                {t.directMessages || 'Личные сообщения'}
                            </h4>
                            <div className="space-y-0.5">
                                {contacts.map(c => renderRow(
                                    personTarget(c.uid, c.name),
                                    c.name,
                                    conversationWith.has(c.uid) ? undefined : (t.newThread || 'новый диалог')
                                ))}
                            </div>
                        </section>
                    )}

                    {destinations && !needle && destinations.boards.length === 0 && contacts.length === 0 && (
                        <p className="text-[11px] text-slate-600 text-center">
                            {t.forwardNowhere || 'Досок и диалогов пока нет — найдите человека по имени.'}
                        </p>
                    )}
                </div>

                <div className="p-5 pt-3 border-t border-slate-800 shrink-0 space-y-3">
                    {/* What is picked stays visible: someone found through the
                        search drops out of the list once the search is cleared. */}
                    {selected.size > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {[...selected.entries()].map(([key, target]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => toggle(target)}
                                    title={t.remove || 'Убрать'}
                                    className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-full bg-cyan-950/50 border border-cyan-500/30 text-[10px] text-cyan-200 hover:border-rose-500/40"
                                >
                                    <span className="truncate">{target.kind === 'feed' ? (t.feedTitle || 'Лента') : targetLabel(target)}</span>
                                    <span aria-hidden="true">✕</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={t.forwardComment || 'Комментарий (необязательно)'}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 resize-none h-14"
                    />
                    {sendsAttachmentsToFeed && (
                        <p className="text-[10px] text-amber-400/80 leading-relaxed">
                            {t.feedNoFiles || 'Лента публичная, а файлы закрыты — в пост попадут только их названия.'}
                        </p>
                    )}
                    {results && (
                        <p className="text-[10px] text-rose-300 leading-relaxed">
                            {t.forwardPartial || 'Не всё удалось переслать. Неудачные адресаты остались выбранными.'}
                        </p>
                    )}
                    <button
                        onClick={handleSend}
                        disabled={selected.size === 0 || sending || isEmptyPayload(payload)}
                        className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold font-mono text-[11px] uppercase tracking-wider transition-colors"
                    >
                        {sending
                            ? (t.sending || 'Отправка…')
                            : `${t.forward || 'Переслать'}${selected.size ? ` (${selected.size})` : ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
};
