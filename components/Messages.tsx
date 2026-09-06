import React, { useState, useEffect, useRef, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { AISettings, Conversation, DirectMessage } from '../types';
import { FollowedProfile } from '../services/social';
import { uploadAttachment, deleteAttachments, attachmentsAvailable, formatSize, MAX_FILE_BYTES } from '../services/attachments';
import { AttachmentView, ImageLightbox } from './Attachments';
import { MessageAttachment } from '../types';
import { translations } from '../translations';
import { auth, searchProfiles } from '../services/firebase';
import {
    subscribeToConversations, subscribeToMessages, openConversation,
    sendDirectMessage, editDirectMessage, deleteDirectMessage,
    otherParticipant
} from '../services/messages';


interface MessagesProps {
    settings: AISettings;
    onViewProfile: (name: string, id?: string) => void;
    /** Subscriptions, already resolved to uid and name. */
    followedProfiles: FollowedProfile[];
    /** Adds someone to the user's subscriptions, the app's contact list. */
    onFollow: (name: string, uid?: string) => void;
}

const Messages: React.FC<MessagesProps> = ({ settings, onViewProfile, onFollow, followedProfiles }) => {
    const t = translations[settings.language] as any;

    // Firebase restores a session asynchronously, so reading currentUser
    // directly would leave this stuck on "sign in" for a signed-in user.
    const [currentUid, setCurrentUid] = useState<string | undefined>(auth.currentUser?.uid);
    useEffect(() => onAuthStateChanged(auth, user => setCurrentUid(user?.uid)), []);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<DirectMessage[]>([]);

    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState<{ id: string, content: string } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<DirectMessage | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Full-size image view, opened by clicking a preview. */
    const [lightbox, setLightbox] = useState<{ url: string, name: string } | null>(null);

    /** Files chosen but not yet sent. */
    const [pending, setPending] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // People picker: subscriptions first, search for everyone else.
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<Array<Record<string, any>>>([]);
    const [searching, setSearching] = useState(false);
    const searchTimer = useRef<number | null>(null);

    const endRef = useRef<HTMLDivElement>(null);

    const active = useMemo(
        () => conversations.find(c => c.id === activeId) || null,
        [conversations, activeId]
    );

    useEffect(() => {
        if (!currentUid) return;
        return subscribeToConversations(currentUid, setConversations);
    }, [currentUid]);

    useEffect(() => {
        if (!activeId) {
            setMessages([]);
            return;
        }
        return subscribeToMessages(activeId, setMessages);
    }, [activeId]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const me = () => ({ id: currentUid!, name: settings.agentName || 'User' });

    // Debounced so typing doesn't fire a query per keystroke.
    useEffect(() => {
        if (!showNew) return;

        if (searchTimer.current) window.clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(async () => {
            setSearching(true);
            try {
                setResults(await searchProfiles(search, currentUid));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimer.current) window.clearTimeout(searchTimer.current);
        };
    }, [search, showNew, currentUid]);

    /** Opens the thread with someone already identified by uid. */
    const startWith = async (id: string, name: string) => {
        if (!currentUid) return;

        setBusy(true);
        setError(null);
        try {
            setActiveId(await openConversation(me(), { id, name }));
            setShowNew(false);
            setSearch('');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleSend = async () => {
        const content = draft.trim();
        const files = pending;

        if ((!content && files.length === 0) || !activeId || !currentUid) return;

        setDraft('');
        setPending([]);
        setError(null);

        try {
            // Uploaded before the message is written, so a message never
            // references a file that failed to store.
            let attachments: MessageAttachment[] = [];

            if (files.length) {
                setUploading(true);
                attachments = await Promise.all(
                    files.map(file => uploadAttachment({ conversationId: activeId }, file))
                );
            }

            await sendDirectMessage(activeId, me(), content, attachments);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setDraft(content);
            setPending(files);
        } finally {
            setUploading(false);
        }
    };

    const handlePickFiles = (list: FileList | null) => {
        if (!list) return;

        const chosen = Array.from(list);
        const tooBig = chosen.find(f => f.size > MAX_FILE_BYTES);

        if (tooBig) {
            setError(`${tooBig.name}: ${t.fileTooBig || 'файл больше'} ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`);
            return;
        }

        setError(null);
        setPending(prev => [...prev, ...chosen]);
    };

    const handleSaveEdit = async () => {
        if (!editing || !activeId) return;

        try {
            await editDirectMessage(activeId, editing.id, editing.content);
            setEditing(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete || !activeId) return;

        try {
            // Files first: their keys live only on the message, so removing it
            // first would leave nothing to delete them by.
            await deleteAttachments(confirmDelete.attachments || []);
            await deleteDirectMessage(activeId, confirmDelete.id!);
            setConfirmDelete(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    if (!currentUid) {
        return (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                {t.loginRequired || 'Войдите, чтобы использовать сообщения'}
            </div>
        );
    }

    return (
        <div className="absolute inset-0 flex bg-slate-950">

            <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-500 font-bold">
                        {t.directMessages || 'Сообщения'}
                    </span>
                    <button
                        onClick={() => { setShowNew(true); setError(null); }}
                        className="text-slate-500 hover:text-cyan-400 transition-colors"
                        title={t.newConversation || 'Новый диалог'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {conversations.length === 0 ? (
                        <p className="text-center text-slate-600 text-xs p-6 leading-relaxed">
                            {t.noConversations || 'Диалогов пока нет.'}
                        </p>
                    ) : conversations.map(conversation => {
                        const other = otherParticipant(conversation, currentUid);
                        const isActive = conversation.id === activeId;

                        return (
                            <button
                                key={conversation.id}
                                onClick={() => setActiveId(conversation.id!)}
                                className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${isActive
                                    ? 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300'
                                    : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                                    }`}
                            >
                                <span className="text-sm font-medium truncate block">
                                    {other?.name || '—'}
                                </span>
                                {conversation.lastMessage && (
                                    <span className="text-[10px] text-slate-600 truncate block mt-0.5">
                                        {conversation.lastMessage.authorId === currentUid ? `${t.you || 'вы'}: ` : ''}
                                        {conversation.lastMessage.content || (t.messageDeleted || 'сообщение удалено')}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </aside>

            <section className="flex-1 flex flex-col min-w-0">
                {!active ? (
                    <div className="flex-1 flex items-center justify-center text-slate-600 text-sm px-8 text-center">
                        {t.selectConversation || 'Выберите диалог или начните новый'}
                    </div>
                ) : (
                    <>
                        <header className="h-14 shrink-0 border-b border-slate-800 flex items-center px-5">
                            <button
                                onClick={() => {
                                    const other = otherParticipant(active, currentUid);
                                    if (other) onViewProfile(other.name, other.id);
                                }}
                                className="font-mono text-sm text-slate-200 hover:underline truncate"
                            >
                                {otherParticipant(active, currentUid)?.name || '—'}
                            </button>
                        </header>

                        {error && (
                            <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex justify-between items-center">
                                <span>{error}</span>
                                <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-300 ml-3">✕</button>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-5 space-y-3 min-w-0">
                            {messages.length === 0 ? (
                                <p className="text-center text-slate-600 text-xs py-12">
                                    {t.noMessagesYet || 'Сообщений пока нет.'}
                                </p>
                            ) : messages.map(message => {
                                const mine = message.authorId === currentUid;
                                const isDeleted = Boolean(message.deletedAt);
                                const isEditing = editing?.id === message.id;

                                return (
                                    <div
                                        key={message.id}
                                        className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div className={`max-w-[75%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                                            {isEditing ? (
                                                <div className="w-full">
                                                    <textarea
                                                        autoFocus
                                                        value={editing.content}
                                                        onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                                                            if (e.key === 'Escape') setEditing(null);
                                                        }}
                                                        className="w-full bg-slate-950 border border-cyan-500/40 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none resize-none h-20"
                                                    />
                                                    <div className="flex justify-end space-x-2 mt-1">
                                                        <button
                                                            onClick={() => setEditing(null)}
                                                            className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-slate-300"
                                                        >
                                                            {t.cancel || 'Отмена'}
                                                        </button>
                                                        <button
                                                            onClick={handleSaveEdit}
                                                            className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
                                                        >
                                                            {t.save || 'Сохранить'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    className={`px-4 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap ${isDeleted
                                                        ? 'bg-slate-900/50 text-slate-600 italic border border-slate-800'
                                                        : mine
                                                            ? 'bg-cyan-950/40 text-cyan-100 border border-cyan-500/20'
                                                            : 'bg-slate-800/60 text-slate-200 border border-slate-700'
                                                        }`}
                                                >
                                                    {isDeleted
                                                        ? (t.messageDeleted || 'сообщение удалено')
                                                        : message.content}

                                                    {!isDeleted && message.attachments?.map(a => (
                                                        <AttachmentView
                                                            key={a.key}
                                                            attachment={a}
                                                            failedLabel={t.downloadFailed || 'не удалось открыть'}
                                                            saveLabel={t.saveFile || 'скачать'}
                                                            onOpen={(url, a) => setLightbox({ url, name: a.name })}
                                                        />
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex items-center space-x-2 mt-1 px-1">
                                                <span className="text-[9px] font-mono text-slate-600">
                                                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {message.editedAt && !isDeleted && (
                                                    <span className="text-[9px] font-mono text-slate-600">
                                                        {t.edited || 'изменено'}
                                                    </span>
                                                )}
                                                {mine && !isDeleted && !isEditing && (
                                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                                                        <button
                                                            onClick={() => setEditing({ id: message.id!, content: message.content })}
                                                            className="text-[9px] font-mono uppercase text-slate-500 hover:text-cyan-400"
                                                        >
                                                            {t.edit || 'изменить'}
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmDelete(message)}
                                                            className="text-[9px] font-mono uppercase text-slate-500 hover:text-rose-400"
                                                        >
                                                            {t.delete || 'удалить'}
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={endRef} />
                        </div>

                        <div className="shrink-0 border-t border-slate-800 p-4">
                            {pending.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {pending.map((file, index) => (
                                        <span
                                            key={`${file.name}-${index}`}
                                            className="inline-flex items-center space-x-2 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-[11px] text-slate-300"
                                        >
                                            <span className="truncate max-w-[160px]">{file.name}</span>
                                            <span className="text-slate-600">{formatSize(file.size)}</span>
                                            <button
                                                onClick={() => setPending(prev => prev.filter((_, i) => i !== index))}
                                                className="text-slate-500 hover:text-rose-400 transition-colors"
                                            >
                                                ✕
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-end space-x-3">
                                {attachmentsAvailable() && (
                                    <>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            hidden
                                            onChange={(e) => {
                                                handlePickFiles(e.target.files);
                                                // Reset so picking the same file twice still fires.
                                                e.target.value = '';
                                            }}
                                        />
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={uploading}
                                            title={t.attachFile || 'Прикрепить файл'}
                                            className="h-[46px] w-[46px] shrink-0 rounded-xl border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors disabled:opacity-40"
                                        >
                                            📎
                                        </button>
                                    </>
                                )}

                                <textarea
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                    }}
                                    placeholder={t.messagePlaceholderDm || 'Сообщение'}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors resize-none h-[46px] max-h-32"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={(!draft.trim() && pending.length === 0) || uploading}
                                    className="h-[46px] px-5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold transition-all active:scale-95 shrink-0"
                                >
                                    {uploading ? '...' : (t.send || 'Отпр.')}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </section>

            {lightbox && (
                <ImageLightbox
                    url={lightbox.url}
                    name={lightbox.name}
                    zoomLabel={t.actualSize || 'увеличить'}
                    fitLabel={t.fitToWindow || 'вписать'}
                    onClose={() => setLightbox(null)}
                />
            )}

            {showNew && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full flex flex-col max-h-[80vh]">
                        <div className="p-5 border-b border-slate-800 flex items-start justify-between shrink-0">
                            <div>
                                <h3 className="text-lg font-bold font-display text-white">
                                    {t.newConversation || 'Новый диалог'}
                                </h3>
                                <p className="text-slate-500 text-[11px] mt-0.5">
                                    {t.pickOrSearch || 'Выберите из подписок или найдите человека'}
                                </p>
                            </div>
                            <button
                                onClick={() => { setShowNew(false); setError(null); setSearch(''); }}
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
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t.searchPeople || 'Поиск по имени…'}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
                            />
                        </div>

                        {error && (
                            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs shrink-0">
                                {error}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0 space-y-4">
                            {/* Subscriptions first: messaging someone you already
                                follow is the common case, and it needs no typing. */}
                            {!search.trim() && followedProfiles.length > 0 && (
                                <div>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600">
                                        {t.subscriptions || 'Подписки'}
                                    </span>
                                    <div className="space-y-1 mt-2">
                                        {followedProfiles.map(profile => (
                                            <button
                                                key={profile.uid}
                                                disabled={busy}
                                                onClick={() => startWith(profile.uid, profile.name)}
                                                className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg border border-transparent text-slate-300 hover:bg-slate-800/60 hover:border-slate-700 transition-all disabled:opacity-40"
                                            >
                                                <span className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase">
                                                    {profile.name.charAt(0)}
                                                </span>
                                                <span className="text-sm truncate">{profile.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                {search.trim() && (
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600">
                                        {searching ? (t.searching || 'поиск…') : (t.found || 'найдено')}
                                    </span>
                                )}

                                <div className="space-y-1 mt-2">
                                    {results.length === 0 && search.trim() && !searching ? (
                                        <p className="text-[11px] text-slate-600 py-4 text-center">
                                            {t.nobodyFound || 'Никого не нашлось'}
                                        </p>
                                    ) : results.map(profile => {
                                        const isFollowed = settings.following.includes(profile.uid);

                                        return (
                                            <div
                                                key={profile.uid}
                                                className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors"
                                            >
                                                <button
                                                    disabled={busy}
                                                    onClick={() => startWith(profile.uid, profile.agentName)}
                                                    className="flex items-center space-x-3 min-w-0 flex-1 text-left disabled:opacity-40"
                                                >
                                                    <span className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase">
                                                        {String(profile.agentName).charAt(0)}
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="text-sm text-slate-200 truncate block">
                                                            {profile.agentName}
                                                        </span>
                                                        <span className="text-[10px] text-slate-600 truncate block">
                                                            {profile.agentRole || (profile.role === 'agent' ? 'AI' : '')}
                                                        </span>
                                                    </span>
                                                </button>

                                                <button
                                                    onClick={() => onFollow(profile.agentName, profile.uid)}
                                                    disabled={isFollowed}
                                                    className={`shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors ${isFollowed
                                                        ? 'border-slate-700 text-slate-600'
                                                        : 'border-pink-500/30 bg-pink-950/20 text-pink-300 hover:bg-pink-900/30'
                                                        }`}
                                                >
                                                    {isFollowed ? (t.following || 'в подписках') : (t.follow || 'добавить')}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {confirmDelete && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl max-w-sm w-full p-6">
                        <h3 className="text-lg font-bold font-display text-white mb-1">
                            {t.deleteMessage || 'Удалить сообщение'}
                        </h3>
                        <p className="text-slate-500 text-xs mb-4 leading-relaxed">
                            {t.deleteMessageHint || 'Текст будет удалён, а на его месте останется пометка — собеседник мог его уже прочитать.'}
                        </p>

                        <div className="flex space-x-3">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
                            >
                                {t.cancel || 'Отмена'}
                            </button>
                            <button
                                onClick={handleDelete}
                                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
                            >
                                {t.delete || 'Удалить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Messages;
