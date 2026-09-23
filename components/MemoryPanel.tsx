import React, { useEffect, useState } from 'react';
import { translations } from '../translations';
import { AISettings } from '../types';
import { Hint } from './Learning';
import {
    subscribeToSummary, subscribeToNotes, addNote, deleteNote, resetSummary
} from '../services/agentMemory';
import { ChannelSummary, EMPTY_SUMMARY, MemoryNote, estimateTokens } from '../services/memoryCore';

/**
 * What the bots remember, made visible: the running summary of this channel
 * and the notes kept for the whole board. Memory that cannot be seen cannot
 * be trusted or corrected, so it can be edited here too.
 */

interface MemoryPanelProps {
    boardId: string;
    channelId: string;
    isOwner: boolean;
    language: string;
    settings: AISettings;
    onClose: () => void;
}

const MemoryPanel: React.FC<MemoryPanelProps> = ({ boardId, channelId, isOwner, language, settings, onClose }) => {
    const t = translations[language as 'ru' | 'en' | 'kk'] as any;
    const [summary, setSummary] = useState<ChannelSummary>(EMPTY_SUMMARY);
    const [notes, setNotes] = useState<MemoryNote[]>([]);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => subscribeToSummary(boardId, channelId, setSummary), [boardId, channelId]);
    useEffect(() => subscribeToNotes(boardId, setNotes), [boardId]);

    const run = async (action: () => Promise<void>) => {
        setError(null);
        try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };

    const handleAdd = () => run(async () => {
        const text = draft.trim();
        if (!text) return;
        await addNote(boardId, { text, author: settings.agentName || 'человек', channelId }, settings);
        setDraft('');
    });

    return (
        <aside className="absolute md:relative inset-y-0 right-0 z-20 w-72 shrink-0 border-l border-slate-800 bg-slate-900 md:bg-slate-900/30 flex flex-col">
            <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-amber-300/80 flex items-center justify-between">
                <span>{t.memory || 'Память'} <Hint id="memory" always /></span>
                <button onClick={onClose} className="text-slate-500 hover:text-white" title={t.close || 'Закрыть'}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
                {error && <p className="text-rose-300">{error}</p>}

                <section>
                    <div className="flex items-center justify-between mb-1.5">
                        <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                            {t.channelSummary || 'Сводка канала'}
                        </h4>
                        {summary.text && isOwner && (
                            <button
                                onClick={() => run(() => resetSummary(boardId, channelId))}
                                className="text-[9px] font-mono text-slate-600 hover:text-rose-300"
                                title={t.resetSummaryHint || 'Сводка соберётся заново из последних сообщений'}
                            >
                                {t.reset || 'сбросить'}
                            </button>
                        )}
                    </div>
                    {summary.text ? (
                        <>
                            <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{summary.text}</p>
                            <p className="text-[9px] font-mono text-slate-600 mt-1.5">
                                {summary.coveredCount} {t.messagesCompressed || 'сообщ. сжато'} · ~{estimateTokens(summary.text)} {t.tokensShort || 'ток.'}
                            </p>
                        </>
                    ) : (
                        <p className="text-slate-600 leading-relaxed">
                            {t.noSummaryYet || 'Пока пусто. Когда сообщений станет больше, старые будут сжиматься сюда, и боты перестанут перечитывать их целиком.'}
                        </p>
                    )}
                </section>

                <section>
                    <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">
                        {t.boardNotes || 'Заметки доски'} · {notes.length}
                    </h4>
                    <div className="flex gap-1 mb-2">
                        <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                            placeholder={t.addNote || 'Факт, который боты должны помнить'}
                            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
                        />
                        <button
                            onClick={handleAdd}
                            disabled={!draft.trim()}
                            className="px-2 rounded-md border border-amber-500/30 text-amber-300 disabled:opacity-40"
                        >
                            +
                        </button>
                    </div>
                    {notes.length === 0 ? (
                        <p className="text-slate-600 leading-relaxed">
                            {t.noNotesYet || 'Боты сохраняют сюда важные факты и итоги задач, а потом находят их по смыслу запроса.'}
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {notes.map(note => (
                                <li key={note.id} className="group flex gap-2 items-start">
                                    <span className="flex-1 text-slate-300 leading-snug">
                                        {note.text}
                                        <span className="block text-[9px] font-mono text-slate-600">{note.author}</span>
                                    </span>
                                    <button
                                        onClick={() => run(() => deleteNote(boardId, note.id!))}
                                        className="text-slate-600 hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100"
                                        title={t.delete || 'Удалить'}
                                    >
                                        ✕
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </aside>
    );
};

export default MemoryPanel;
