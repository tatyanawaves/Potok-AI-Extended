import React, { useEffect, useRef, useState } from 'react';
import { translations } from '../translations';
import { AISettings } from '../types';
import { Hint } from './Learning';
import {
    subscribeToSummary, subscribeToNotes, addNote, deleteNote, resetSummary
} from '../services/agentMemory';
import { ChannelSummary, EMPTY_SUMMARY, MemoryNote, estimateTokens } from '../services/memoryCore';
import { KnowledgeDoc, MAX_BOARD_CHUNKS } from '../services/knowledgeCore';
import { subscribeToKnowledge, addToKnowledge, removeFromKnowledge } from '../services/knowledge';
import { auth } from '../services/firebase';

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

    const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
    const [uploading, setUploading] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    useEffect(() => subscribeToKnowledge(boardId, setDocuments), [boardId]);
    const usedChunks = documents.reduce((sum, d) => sum + (d.chunks || 0), 0);

    const handleUpload = (file: File | undefined) => file && run(async () => {
        setUploading('…');
        try {
            await addToKnowledge(boardId, file, settings, setUploading);
        } finally {
            setUploading(null);
            if (fileInput.current) fileInput.current.value = '';
        }
    });

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
        <aside className="absolute lg:relative inset-y-0 right-0 z-20 w-full max-w-xs md:max-w-none md:w-72 shrink-0 border-l border-slate-800 bg-slate-900 lg:bg-slate-900/30 flex flex-col shadow-2xl lg:shadow-none">
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
                    <div className="flex items-center justify-between mb-1.5">
                        <h4 className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                            {t.knowledgeBase || 'База знаний'} · {documents.length} <Hint id="knowledge" />
                        </h4>
                        <span className="text-[9px] font-mono text-slate-600">{usedChunks}/{MAX_BOARD_CHUNKS}</span>
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".txt,.md,.markdown,.csv,.json,.pdf,.docx,text/*"
                        className="hidden"
                        onChange={e => handleUpload(e.target.files?.[0])}
                    />
                    <button
                        onClick={() => fileInput.current?.click()}
                        disabled={Boolean(uploading)}
                        className="w-full mb-2 py-1.5 rounded-md border border-dashed border-amber-500/30 text-amber-300 hover:bg-amber-950/20 disabled:opacity-50"
                    >
                        {uploading ? `${t.uploadingDoc || 'Загрузка'}: ${uploading}` : `+ ${t.addDocument || 'Документ (PDF, DOCX, TXT, MD)'}`}
                    </button>
                    {documents.length === 0 ? (
                        <p className="text-slate-600 leading-relaxed">
                            {t.noKnowledgeYet || 'Загрузите регламенты, инструкции, договоры — боты найдут нужный фрагмент и сошлются на него: [Название §3].'}
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {documents.map(d => (
                                <li key={d.id} className="group flex gap-2 items-start">
                                    <span className="flex-1 text-slate-300 leading-snug break-words">
                                        📄 {d.title}
                                        <span className="block text-[9px] font-mono text-slate-600">
                                            {d.chunks} {t.passagesShort || 'фрагм.'} · {(d.chars || 0) < 1000 ? d.chars || 0 : `${Math.round(d.chars / 1000)}K`} {t.charsShort || 'симв.'} · {d.addedByName}
                                        </span>
                                    </span>
                                    {(isOwner || d.addedBy === auth.currentUser?.uid) && (
                                        <button
                                            onClick={() => window.confirm(`${t.removeDocumentConfirm || 'Убрать из базы знаний'}: ${d.title}?`) && run(() => removeFromKnowledge(boardId, d.id))}
                                            className="text-slate-600 hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100"
                                            title={t.delete || 'Удалить'}
                                        >
                                            ✕
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
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
