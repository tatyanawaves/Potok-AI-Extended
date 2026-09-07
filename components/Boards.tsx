import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useIsWide } from '../hooks/useIsWide';
import { subscribeToReadState, markRead, isBoardUnread, isChannelUnread, EMPTY_READ_STATE } from '../services/reads';
import { subscribeToSpend } from '../services/spend';
import { spendOn, formatTokens, estimateDiscussionRequests } from '../services/usage';
import { SpendState } from '../types';
import { AISettings, Board, BoardChannel, BoardMember, BoardMessage, MessageAttachment } from '../types';
import { uploadAttachment, deleteAttachments, attachmentsAvailable, formatSize, MAX_FILE_BYTES } from '../services/attachments';
import { AttachmentView, ImageLightbox } from './Attachments';
import { translations } from '../translations';
import { auth, getClonableAgentProfiles, searchProfiles } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
    createBoard, subscribeToMyBoards, deleteBoard,
    addMember, addBot, removeMember,
    createChannel, subscribeToChannels, deleteChannel,
    subscribeToMessages, sendMessage, deleteMessage, parseMentions, isBot
} from '../services/boards';
import {
    triggerAgentReplies, runBotDiscussion,
    MAX_DISCUSSION_BOTS, MAX_DISCUSSION_ROUNDS, MAX_REQUESTS_PER_TURN, ToolPolicy
} from '../services/boardAgent';
import {
    isPipedreamConfigured, listConnectedAccounts, toolServerUrlFor, ConnectedAccount
} from '../services/pipedream';
import ToolCatalog from './ToolCatalog';

interface BoardsProps {
    settings: AISettings;
    onViewProfile: (name: string, id?: string) => void;
}

const Boards: React.FC<BoardsProps> = ({ settings, onViewProfile }) => {
    const t = translations[settings.language] as any;

    /**
     * Firebase restores a session asynchronously, so auth.currentUser is still
     * null on the first render after a page load. Reading it directly left the
     * board stuck on "please sign in" for an already-signed-in user, because
     * nothing re-rendered once the session arrived.
     */
    const [currentUid, setCurrentUid] = useState<string | undefined>(auth.currentUser?.uid);

    const isWide = useIsWide();

    useEffect(() => onAuthStateChanged(auth, user => setCurrentUid(user?.uid)), []);

    const [boards, setBoards] = useState<Board[]>([]);
    const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
    const [channels, setChannels] = useState<BoardChannel[]>([]);
    const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
    const [messages, setMessages] = useState<BoardMessage[]>([]);

    const [draft, setDraft] = useState('');
    /** Files chosen but not yet sent, and the image opened for viewing. */
    const [pending, setPending] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [lightbox, setLightbox] = useState<{ url: string, name: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAgentThinking, setIsAgentThinking] = useState(false);
    const [showMembers, setShowMembers] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reads, setReads] = useState(EMPTY_READ_STATE);
    const [spend, setSpend] = useState<SpendState | null>(null);

    // People picker for "add a human": a board member is chosen from a list,
    // not typed. Typing an exact profile name meant a single misspelling read
    // as "no such person".
    const [peopleSearch, setPeopleSearch] = useState('');
    const [people, setPeople] = useState<Array<Record<string, any>>>([]);
    const [searchingPeople, setSearchingPeople] = useState(false);
    const peopleTimer = useRef<number | null>(null);

    // In-app dialogs. window.prompt/confirm are blocked in some browser
    // contexts, so every input goes through this modal instead.
    type ModalState =
        | { kind: 'createBoard' }
        | { kind: 'createChannel' }
        | { kind: 'addHuman' }
        | { kind: 'createBot' }
        | { kind: 'cloneAgent' }
        | { kind: 'discussion' }
        | { kind: 'deleteBoard', boardId: string, boardName: string }
        | { kind: 'deleteChannel', channelId: string, channelName: string };

    const [modal, setModal] = useState<ModalState | null>(null);

    // Destructive dialogs share a look and skip the name input — grouped here
    // so a new one cannot be added to the list of names without inheriting the
    // red confirm button.
    const isDestructiveModal = (state: ModalState | null): boolean =>
        state?.kind === 'deleteBoard' || state?.kind === 'deleteChannel';

    const [modalInput, setModalInput] = useState('');
    const [botPrompt, setBotPrompt] = useState('');
    const [botToolUrl, setBotToolUrl] = useState('');
    const [pipedreamAccounts, setPipedreamAccounts] = useState<ConnectedAccount[]>([]);
    const [showCatalog, setShowCatalog] = useState(false);
    const [clonable, setClonable] = useState<Array<Record<string, any>>>([]);
    const [selectedClone, setSelectedClone] = useState<Record<string, any> | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Bot-to-bot discussion: who takes part, what for, and how long it runs.
    const [discussionBots, setDiscussionBots] = useState<string[]>([]);
    const [discussionRounds, setDiscussionRounds] = useState(2);
    const [discussionProgress, setDiscussionProgress] = useState<
        { turn: number, total: number, bot: string } | null
    >(null);
    const [toolPolicy, setToolPolicy] = useState<ToolPolicy>('ask');
    const stopDiscussionRef = useRef(false);

    /**
     * Pending tool approval. The promise is resolved by the dialog's buttons,
     * which suspends the bot's turn until the operator decides.
     */
    const [pendingTool, setPendingTool] = useState<
        { bot: string, tool: string, args: Record<string, any>, resolve: (ok: boolean) => void } | null
    >(null);

    const requestToolApproval = (bot: string, tool: string, args: Record<string, any>) =>
        new Promise<boolean>(resolve => setPendingTool({ bot, tool, args, resolve }));

    const answerToolApproval = (allowed: boolean) => {
        pendingTool?.resolve(allowed);
        setPendingTool(null);
    };

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const modalInputRef = useRef<HTMLInputElement>(null);

    const openModal = (state: ModalState) => {
        setModalInput('');
        setPeopleSearch('');
        setPeople([]);
        setBotPrompt('');
        setBotToolUrl('');
        setSelectedClone(null);
        setError(null);
        setModal(state);

        if (state.kind === 'discussion') {
            // Preselect the bots on the board, capped at what one run allows.
            setDiscussionBots(
                (activeBoard?.members.filter(isBot) || [])
                    .slice(0, MAX_DISCUSSION_BOTS)
                    .map(b => b.id)
            );
        }

        if (state.kind === 'createBot' && isPipedreamConfigured()) {
            listConnectedAccounts()
                .then(setPipedreamAccounts)
                .catch(() => setPipedreamAccounts([]));
        }

        if (state.kind === 'cloneAgent') {
            getClonableAgentProfiles()
                .then(setClonable)
                .catch(e => setError(e instanceof Error ? e.message : String(e)));
        }
    };

    const closeModal = () => {
        setModal(null);
        setModalInput('');
        setBotPrompt('');
        setBotToolUrl('');
        setSelectedClone(null);
    };

    const activeBoard = useMemo(
        () => boards.find(b => b.id === activeBoardId) || null,
        [boards, activeBoardId]
    );
    const activeChannel = useMemo(
        () => channels.find(c => c.id === activeChannelId) || null,
        [channels, activeChannelId]
    );

    // --- Subscriptions ---

    useEffect(() => {
        if (!currentUid) return;
        return subscribeToMyBoards(currentUid, setBoards);
    }, [currentUid]);

    useEffect(() => {
        if (!activeBoardId) {
            setChannels([]);
            return;
        }
        return subscribeToChannels(activeBoardId, setChannels);
    }, [activeBoardId]);

    useEffect(() => {
        if (!activeBoardId || !activeChannelId) {
            setMessages([]);
            return;
        }
        return subscribeToMessages(activeBoardId, activeChannelId, setMessages);
    }, [activeBoardId, activeChannelId]);

    // Select the first board / channel once they load.
    // Picking the first board for the user only helps when the list stays
    // visible beside it. On one column it would undo every tap on "back".
    useEffect(() => {
        if (isWide && !activeBoardId && boards.length > 0) setActiveBoardId(boards[0].id!);
    }, [boards, activeBoardId, isWide]);

    useEffect(() => {
        if (!currentUid) return;
        return subscribeToReadState(currentUid, setReads);
    }, [currentUid]);

    useEffect(() => {
        if (!currentUid) return;
        return subscribeToSpend(currentUid, setSpend);
    }, [currentUid]);

    // Debounced so typing does not fire a query per keystroke. An empty term
    // lists everyone, which is what makes the picker usable before you type.
    useEffect(() => {
        if (modal?.kind !== 'addHuman') return;

        if (peopleTimer.current) window.clearTimeout(peopleTimer.current);
        setSearchingPeople(true);

        peopleTimer.current = window.setTimeout(async () => {
            try {
                setPeople(await searchProfiles(peopleSearch, currentUid));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setSearchingPeople(false);
            }
        }, 250);

        return () => {
            if (peopleTimer.current) window.clearTimeout(peopleTimer.current);
        };
    }, [modal, peopleSearch, currentUid]);

    // While a channel is open its messages count as seen, including ones that
    // arrive as you watch — a bot answering in front of you is not unread.
    useEffect(() => {
        if (!currentUid || !activeBoardId || !activeChannelId) return;
        markRead(currentUid, { channelId: activeChannelId, boardId: activeBoardId }).catch(() => { });
    }, [currentUid, activeBoardId, activeChannelId, messages.length]);

    useEffect(() => {
        if (channels.length === 0) {
            setActiveChannelId(null);
        } else if (activeChannelId && !channels.some(c => c.id === activeChannelId)) {
            // The open channel is gone (deleted): move to a surviving one.
            setActiveChannelId(channels[0].id!);
        } else if (isWide && !activeChannelId) {
            setActiveChannelId(channels[0].id!);
        }
    }, [channels, activeChannelId, isWide]);

    /**
     * Keep the newest message in view.
     *
     * Jumping, not gliding, when the channel changes: a smooth scroll over a
     * long history is still travelling when an attachment image finishes
     * loading and grows the page, and the animation ends somewhere in the
     * middle of old messages — which reads as an empty channel.
     */
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [activeChannelId]);


    /**
     * Images finish loading after the scroll has already happened, and each one
     * pushes the newest message further down. Nothing fires on that, so the
     * load events of the images themselves are the signal to catch up.
     */
    useEffect(() => {
        const end = messagesEndRef.current;
        const scroller = end?.parentElement;
        if (!scroller) return;

        const stick = () => end?.scrollIntoView({ behavior: 'auto' });
        scroller.addEventListener('load', stick, true);
        return () => scroller.removeEventListener('load', stick, true);
    }, [activeChannelId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // --- Actions ---

    const handleCreateBoard = async (name: string) => {
        if (!name.trim() || !currentUid) return;

        const created = await createBoard(name.trim(), '', { id: currentUid, name: settings.agentName || 'User' });
        setActiveBoardId(created.id);
    };

    const handleDeleteBoard = async (boardId: string) => {
        await deleteBoard(boardId);
        if (activeBoardId === boardId) setActiveBoardId(null);
    };

    const handleDeleteChannel = async (channelId: string) => {
        if (!activeBoardId) return;

        // Selection is not touched here: the effect watching `channels` moves
        // off a channel that no longer exists, so it stays the single owner of
        // which channel is open.
        await deleteChannel(activeBoardId, channelId);
    };

    const handleCreateChannel = async (name: string) => {
        if (!name.trim() || !activeBoardId) return;
        await createChannel(activeBoardId, name.trim(), '');
    };

    /**
     * Adds a chosen profile to the board.
     *
     * Identity comes from the picked uid, never from the typed text: two people
     * may share a display name, and the one you clicked is the one who joins.
     */
    const handleAddPerson = async (profile: Record<string, any>) => {
        if (!activeBoardId) return;

        if (activeBoard?.memberIds.includes(profile.uid)) {
            throw new Error(t.alreadyMember || 'Уже участник доски');
        }

        await addMember(activeBoardId, {
            id: profile.uid,
            name: profile.agentName,
            type: 'human'
        });
    };

    const nameIsTaken = (name: string): boolean =>
        Boolean(activeBoard?.members.some(m => m.name.toLowerCase() === name.trim().toLowerCase()));

    const handleCreateBot = async (name: string, systemPrompt: string) => {
        if (!activeBoardId || !currentUid) return;

        if (nameIsTaken(name)) {
            throw new Error(t.nameTaken || 'Участник с таким именем уже есть — упоминания станут неоднозначными');
        }

        await addBot(activeBoardId, {
            name,
            systemPrompt,
            ownerId: currentUid,
            toolServerUrl: botToolUrl.trim() || undefined
        });
    };

    const handleCloneAgent = async (profile: Record<string, any>, name: string) => {
        if (!activeBoardId || !currentUid) return;

        if (nameIsTaken(name)) {
            throw new Error(t.nameTaken || 'Участник с таким именем уже есть — упоминания станут неоднозначными');
        }

        await addBot(activeBoardId, {
            name,
            systemPrompt: profile.agentPrompt || profile.agentRole || '',
            ownerId: currentUid,
            sourceAgentId: profile.uid,
            sourceAgentName: profile.agentName
        });
    };

    /**
     * Posts the brief, then lets the chosen bots take a fixed number of turns.
     * Every turn is one API call on this user's key, so the cost is exactly
     * bots × rounds and is shown before the run starts.
     */
    const handleStartDiscussion = async (task: string) => {
        if (!activeBoard || !activeChannel || !activeChannelId || !currentUid) return;

        const bots = activeBoard.members.filter(m => discussionBots.includes(m.id));
        if (bots.length === 0) throw new Error(t.pickBots || 'Выберите хотя бы одного бота');
        if (!task.trim()) throw new Error(t.taskRequired || 'Опишите задачу');

        closeModal();
        stopDiscussionRef.current = false;

        await sendMessage({
            channelId: activeChannelId,
            boardId: activeBoard.id!,
            authorId: currentUid,
            authorName: settings.agentName || 'User',
            authorType: settings.userType === 'agent' ? 'agent' : 'human',
            content: `${t.discussionBrief || 'Обсуждение'}: ${task.trim()}\n${bots.map(b => `@${b.name}`).join(' ')}`
        });

        try {
            await runBotDiscussion({
                boardId: activeBoard.id!,
                channelId: activeChannelId,
                channelName: activeChannel.name,
                bots,
                task: task.trim(),
                rounds: discussionRounds,
                settings,
                onTurn: (turn, total, bot) => setDiscussionProgress({ turn, total, bot }),
                shouldStop: () => stopDiscussionRef.current,
                toolPolicy,
                approveTool: requestToolApproval
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setDiscussionProgress(null);
        }
    };

    /** Runs the action behind the currently open modal. */
    const handleModalSubmit = async () => {
        if (!modal || isSubmitting) return;

        setIsSubmitting(true);
        setError(null);

        try {
            if (modal.kind === 'createBoard') {
                await handleCreateBoard(modalInput);
            } else if (modal.kind === 'createChannel') {
                await handleCreateChannel(modalInput);
            } else if (modal.kind === 'addHuman') {
                throw new Error(t.pickPerson || 'Выберите человека из списка');
            } else if (modal.kind === 'createBot') {
                await handleCreateBot(modalInput, botPrompt);
            } else if (modal.kind === 'cloneAgent') {
                if (!selectedClone) throw new Error(t.pickAgent || 'Выберите персону');
                await handleCloneAgent(selectedClone, modalInput || selectedClone.agentName);
            } else if (modal.kind === 'discussion') {
                // Closes the modal itself: the run continues after it is gone.
                await handleStartDiscussion(botPrompt);
                return;
            } else if (modal.kind === 'deleteBoard') {
                await handleDeleteBoard(modal.boardId);
            } else if (modal.kind === 'deleteChannel') {
                await handleDeleteChannel(modal.channelId);
            }
            closeModal();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSubmitting(false);
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

    const handleSend = async () => {
        const content = draft.trim();
        const files = pending;

        if ((!content && files.length === 0) || !activeChannelId || !currentUid || !activeChannel || !activeBoard) return;

        setDraft('');
        setPending([]);
        setError(null);

        try {
            // parseMentions rather than a hand-rolled regex: \b is an ASCII
            // word boundary, so `@Маркетолог ` never matched and the bot was
            // silently skipped. This also keeps the check identical to the one
            // triggerAgentReplies runs on the stored mentions.
            const mentionedNames = parseMentions(content);
            const mentionsBot = activeBoard.members.some(m =>
                isBot(m) &&
                m.id !== currentUid &&
                mentionedNames.some(name => name.toLowerCase() === m.name.toLowerCase())
            );

            // Uploaded before the message is written, so a message never
            // references a file that failed to store.
            let attachments: MessageAttachment[] = [];

            if (files.length) {
                setUploading(true);
                attachments = await Promise.all(
                    files.map(file => uploadAttachment({ boardId: activeBoard.id! }, file))
                );
                setUploading(false);
            }

            const sent = await sendMessage({
                channelId: activeChannelId,
                boardId: activeBoard.id!,
                authorId: currentUid,
                authorName: settings.agentName || 'User',
                authorType: settings.userType === 'agent' ? 'agent' : 'human',
                content,
                ...(attachments.length ? { attachments } : {})
            });

            if (!mentionsBot) return;

            // Replies are generated here, on this user's key: mentioning a bot
            // is what costs tokens, so the mentioner pays for it.
            setIsAgentThinking(true);
            try {
                await triggerAgentReplies(
                    {
                        id: sent.id,
                        channelId: activeChannelId,
                        boardId: activeBoard.id!,
                        authorId: currentUid,
                        authorName: settings.agentName || 'User',
                        authorType: 'human',
                        content,
                        mentions: parseMentions(content),
                        timestamp: Date.now()
                    },
                    activeChannelId,
                    activeBoard.id!,
                    activeChannel.name,
                    activeBoard.members,
                    settings
                );
            } finally {
                setIsAgentThinking(false);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setDraft(content);
            setPending(files);
        } finally {
            setUploading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // --- Render ---

    if (!currentUid) {
        return (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                {t.loginRequired || 'Войдите, чтобы использовать доски'}
            </div>
        );
    }

    return (
        // Absolute rather than h-full: the routed <main> is a flex child whose
        // height is content-driven, so a percentage height would collapse.
        //
        // Three fixed columns need about 700px before the messages themselves
        // get any room, so on a narrow screen they become one column at a
        // time: boards, then channels, then the conversation. Which one shows
        // follows the selection that already exists, so there is no second
        // idea of "where you are" to keep in sync.
        <div className="absolute inset-0 flex bg-slate-950">

            {/* Board list */}
            <aside className={`${activeBoardId ? 'hidden md:flex' : 'flex'} w-full md:w-56 shrink-0 border-r border-slate-800 bg-slate-900/40 flex-col`}>
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-500 font-bold">
                        {t.boards || 'Доски'}
                    </span>
                    <button
                        onClick={() => openModal({ kind: 'createBoard' })}
                        className="text-slate-500 hover:text-cyan-400 transition-colors"
                        title={t.createBoard || 'Создать доску'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {boards.length === 0 ? (
                        <p className="text-center text-slate-600 text-xs p-6 leading-relaxed">
                            {t.noBoards || 'Пока нет досок. Создайте первую.'}
                        </p>
                    ) : boards.map(board => (
                        <div
                            key={board.id}
                            onClick={() => setActiveBoardId(board.id!)}
                            className={`group px-3 py-2 rounded-lg cursor-pointer border transition-all ${activeBoardId === board.id
                                ? 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300'
                                : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-sm truncate ${isBoardUnread(board, reads, currentUid || '') ? 'font-bold text-white' : 'font-medium'}`}>
                                    {isBoardUnread(board, reads, currentUid || '') && (
                                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                                    )}
                                    {board.name}
                                </span>
                                {board.ownerId === currentUid && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openModal({ kind: 'deleteBoard', boardId: board.id!, boardName: board.name }); }}
                                        className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                        title={t.delete || 'Удалить'}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            <div className="text-[10px] font-mono text-slate-600 mt-0.5">
                                {board.members.length} {t.membersShort || 'уч.'} · {board.members.filter(isBot).length} AI
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* Channel list */}
            {activeBoard && (
                <aside className={`${activeChannelId ? 'hidden md:flex' : 'flex'} w-full md:w-48 shrink-0 border-r border-slate-800 bg-slate-900/20 flex-col`}>
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-indigo-400 font-bold flex items-center">
                            <button
                                onClick={() => setActiveBoardId(null)}
                                className="md:hidden mr-2 text-slate-500 hover:text-white transition-colors"
                                title={t.backToBoards || 'К доскам'}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            {t.channels || 'Каналы'}
                        </span>
                        <button
                            onClick={() => openModal({ kind: 'createChannel' })}
                            className="text-slate-500 hover:text-indigo-400 transition-colors"
                            title={t.createChannel || 'Создать канал'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                        {channels.map(channel => (
                            <div
                                key={channel.id}
                                onClick={() => setActiveChannelId(channel.id!)}
                                className={`group px-3 py-1.5 rounded-md cursor-pointer flex items-center justify-between transition-all ${activeChannelId === channel.id
                                    ? 'bg-indigo-950/40 text-indigo-300'
                                    : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                                    }`}
                            >
                                <span className={`text-sm truncate font-mono ${isChannelUnread(channel, reads, currentUid || '') ? 'text-white font-bold' : ''}`}>
                                    {isChannelUnread(channel, reads, currentUid || '') && (
                                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                                    )}
                                    #{channel.name}
                                </span>
                                {activeBoard.ownerId === currentUid && channels.length > 1 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openModal({ kind: 'deleteChannel', channelId: channel.id!, channelName: channel.name });
                                        }}
                                        className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                        title={t.delete || 'Удалить'}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </aside>
            )}

            {/* Message area */}
            <section className={`${activeChannelId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
                {!activeBoard ? (
                    <div className="flex-1 flex items-center justify-center text-slate-600 text-sm px-8 text-center">
                        {t.selectOrCreateBoard || 'Выберите доску или создайте новую'}
                    </div>
                ) : (
                    <>
                        <header className="min-h-14 shrink-0 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap px-3 md:px-5 py-2">
                            <button
                                onClick={() => setActiveChannelId(null)}
                                className="md:hidden mr-3 shrink-0 text-slate-500 hover:text-white transition-colors"
                                title={t.backToChannels || 'К каналам'}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>

                            <div className="min-w-0">
                                <div className="font-mono text-sm text-slate-200 truncate">
                                    #{activeChannel?.name || '—'}
                                </div>
                                <div className="text-[10px] text-slate-600 truncate">{activeBoard.name}</div>
                            </div>

                            {/* Today's model usage, on this user's own key. */}
                            {spendOn(spend).requests > 0 && (
                                <div
                                    className="text-[10px] font-mono text-slate-500 shrink-0 md:px-2"
                                    title={t.spendHint || 'Запросы к модели с вашего ключа за сегодня. Платит тот, кто упомянул бота.'}
                                >
                                    {t.today || 'сегодня'}: {spendOn(spend).requests} {t.requestsShort || 'запр.'} · {formatTokens(spendOn(spend).tokens)} {t.tokensShort || 'ток.'}
                                </div>
                            )}

                            <div className="flex items-center space-x-2 shrink-0">
                                {isPipedreamConfigured() && (
                                    <button
                                        onClick={() => setShowCatalog(true)}
                                        className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-900/30 transition-all"
                                        title={t.toolCatalog || 'Инструменты'}
                                    >
                                        ⚒ {t.tools || 'Инструменты'}
                                    </button>
                                )}

                                {activeBoard.members.some(isBot) && activeChannelId && (
                                    <button
                                        onClick={() => openModal({ kind: 'discussion' })}
                                        disabled={Boolean(discussionProgress)}
                                        className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border border-indigo-500/30 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40 transition-all disabled:opacity-40"
                                    >
                                        {t.discussion || 'Совещание'}
                                    </button>
                                )}

                                <button
                                    onClick={() => setShowMembers(!showMembers)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${showMembers
                                        ? 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300'
                                        : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                                        }`}
                                >
                                    {t.members || 'Участники'} ({activeBoard.members.length})
                                </button>
                            </div>
                        </header>

                        {error && (
                            <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex justify-between items-center">
                                <span>{error}</span>
                                <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-300 ml-3">✕</button>
                            </div>
                        )}

                        <div className="flex-1 flex min-h-0">
                            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-w-0">
                                {messages.length === 0 ? (
                                    <p className="text-center text-slate-600 text-xs py-12 leading-relaxed">
                                        {t.noMessages || 'Сообщений пока нет.'}<br />
                                        {t.mentionHint || 'Упомяните агента через @имя, чтобы он ответил.'}
                                    </p>
                                ) : messages.map(msg => (
                                    <div key={msg.id} className="group flex space-x-3">
                                        <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${msg.authorType === 'agent'
                                            ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30'
                                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                                            }`}>
                                            {msg.authorName.charAt(0).toUpperCase()}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline space-x-2">
                                                <button
                                                    onClick={() => onViewProfile(msg.authorName, msg.authorId)}
                                                    className={`text-sm font-bold hover:underline ${msg.authorType === 'agent' ? 'text-indigo-300' : 'text-slate-200'}`}
                                                >
                                                    {msg.authorName}
                                                </button>
                                                {msg.authorType === 'agent' && (
                                                    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-400 border border-indigo-500/20">
                                                        AI
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-slate-600 font-mono">
                                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {msg.authorId === currentUid && (
                                                    <button
                                                        onClick={async () => {
                                                            // Keys live only on the message; delete
                                                            // the files before it is gone.
                                                            await deleteAttachments(msg.attachments || []);
                                                            await deleteMessage(activeBoard.id!, msg.channelId, msg.id!);
                                                        }}
                                                        className="text-slate-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed mt-0.5">
                                                {msg.content}
                                            </p>

                                            {msg.attachments?.map(a => (
                                                <AttachmentView
                                                    key={a.key}
                                                    attachment={a}
                                                    failedLabel={t.downloadFailed || 'не удалось открыть'}
                                                    saveLabel={t.saveFile || 'скачать'}
                                                    onOpen={(url, at) => setLightbox({ url, name: at.name })}
                                                />
                                            ))}
                                            {msg.toolsUsed?.length ? (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {msg.toolsUsed.map(tool => (
                                                        <span
                                                            key={tool}
                                                            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/20"
                                                        >
                                                            ⚒ {tool}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : null}
                                            {msg.modelName && (
                                                <div className="text-[9px] font-mono text-slate-700 mt-1">
                                                    {msg.modelName}
                                                    {msg.tokensUsed ? ` · ${formatTokens(msg.tokensUsed)} ${t.tokensShort || 'ток.'}` : ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {isAgentThinking && !discussionProgress && (
                                    <div className="flex items-center space-x-2 text-indigo-400 text-xs font-mono pl-11">
                                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
                                        <span>{t.agentThinking || 'агент печатает...'}</span>
                                    </div>
                                )}

                                {discussionProgress && (
                                    <div className="flex items-center justify-between pl-11 pr-2 py-2">
                                        <div className="flex items-center space-x-2 text-indigo-400 text-xs font-mono min-w-0">
                                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shrink-0"></span>
                                            <span className="truncate">
                                                {discussionProgress.bot} · {t.turn || 'ход'} {discussionProgress.turn}/{discussionProgress.total}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => { stopDiscussionRef.current = true; }}
                                            className="shrink-0 ml-3 px-2.5 py-1 rounded-md border border-rose-500/30 bg-rose-950/20 text-rose-300 text-[10px] font-mono uppercase tracking-wider hover:bg-rose-900/30 transition-colors"
                                        >
                                            {t.stop || 'Стоп'}
                                        </button>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Members panel */}
                            {showMembers && (
                                <aside className="absolute md:relative inset-y-0 right-0 z-20 w-64 shrink-0 border-l border-slate-800 bg-slate-900 md:bg-slate-900/30 flex flex-col">
                                    <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-slate-400">
                                        {t.members || 'Участники'}
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                        {activeBoard.members.map(member => (
                                            <div key={member.id} className="group px-3 py-2 rounded-lg hover:bg-slate-800/50 flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <button
                                                        onClick={() => onViewProfile(
                                                            member.sourceAgentName || member.name,
                                                            member.sourceAgentId || member.id
                                                        )}
                                                        className={`text-sm truncate hover:underline block ${isBot(member) ? 'text-indigo-300' : 'text-slate-300'}`}
                                                    >
                                                        {member.name}
                                                    </button>
                                                    <span className="text-[9px] font-mono text-slate-600 uppercase block">
                                                        {isBot(member) ? 'Bot' : 'Human'}
                                                        {member.role === 'owner' && ` · ${t.owner || 'владелец'}`}
                                                    </span>
                                                    {isBot(member) && member.sourceAgentName && (
                                                        <span className="text-[9px] font-mono text-slate-700 block truncate">
                                                            ↳ {member.sourceAgentName}
                                                        </span>
                                                    )}
                                                    {member.toolServerUrl && (
                                                        <span
                                                            className="text-[9px] font-mono text-emerald-500/70 block truncate"
                                                            title={member.toolServerUrl}
                                                        >
                                                            ⚒ {new URL(member.toolServerUrl).hostname}
                                                        </span>
                                                    )}
                                                </div>

                                                {activeBoard.ownerId === currentUid && member.role !== 'owner' && (
                                                    <button
                                                        onClick={() => removeMember(activeBoard.id!, member.id).catch(e => setError(String(e)))}
                                                        className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {activeBoard.ownerId === currentUid && (
                                        <div className="p-3 border-t border-slate-800 space-y-2">
                                            <button
                                                onClick={() => openModal({ kind: 'createBot' })}
                                                className="w-full py-2 rounded-lg bg-indigo-900/30 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono uppercase tracking-wider hover:bg-indigo-900/50 transition-colors"
                                            >
                                                + {t.createBot || 'Создать бота'}
                                            </button>
                                            <button
                                                onClick={() => openModal({ kind: 'cloneAgent' })}
                                                className="w-full py-2 rounded-lg bg-indigo-900/20 text-indigo-300/80 border border-indigo-500/20 text-[10px] font-mono uppercase tracking-wider hover:bg-indigo-900/40 transition-colors"
                                            >
                                                + {t.cloneAgent || 'Бот из персоны'}
                                            </button>
                                            <button
                                                onClick={() => openModal({ kind: 'addHuman' })}
                                                className="w-full py-2 rounded-lg bg-slate-800/50 text-slate-300 border border-slate-700 text-[10px] font-mono uppercase tracking-wider hover:bg-slate-800 transition-colors"
                                            >
                                                + {t.addHuman || 'Добавить человека'}
                                            </button>
                                        </div>
                                    )}
                                </aside>
                            )}
                        </div>

                        {/* Composer */}
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
                                            disabled={uploading || !activeChannelId}
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
                                    onKeyDown={handleKeyDown}
                                    disabled={!activeChannelId}
                                    placeholder={activeChannel
                                        // The full hint wraps to a second line on a phone,
                                        // where the field is one line tall — so it is cut in
                                        // half rather than shown.
                                        ? (isWide
                                            ? `${t.messagePlaceholder || 'Сообщение в'} #${activeChannel.name}  ·  @${t.mentionAgentHint || 'имя для вызова агента'}`
                                            : `#${activeChannel.name}  ·  @${t.mentionAgentHint || 'имя'}`)
                                        : (t.noChannel || 'Создайте канал')}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors resize-none h-[46px] max-h-32 disabled:opacity-40"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={(!draft.trim() && pending.length === 0) || !activeChannelId || uploading}
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

            {pendingTool && (
                <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-lg font-bold font-display text-white mb-1">
                            {t.toolRequest || 'Запрос инструмента'}
                        </h3>
                        <p className="text-slate-500 text-xs mb-4">
                            <span className="text-indigo-300">{pendingTool.bot}</span>{' '}
                            {t.wantsToCall || 'хочет вызвать инструмент. Это действие в вашем подключённом аккаунте.'}
                        </p>

                        <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 mb-4">
                            <div className="text-[11px] font-mono text-emerald-400 break-all">
                                ⚒ {pendingTool.tool}
                            </div>
                            {Object.keys(pendingTool.args).length > 0 && (
                                <pre className="text-[10px] text-slate-500 mt-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                    {JSON.stringify(pendingTool.args, null, 2)}
                                </pre>
                            )}
                        </div>

                        <div className="flex space-x-3">
                            <button
                                onClick={() => answerToolApproval(false)}
                                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
                            >
                                {t.deny || 'Отклонить'}
                            </button>
                            <button
                                onClick={() => answerToolApproval(true)}
                                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-[10px] uppercase tracking-wider shadow-lg shadow-emerald-900/20 transition-colors"
                            >
                                {t.allow || 'Разрешить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCatalog && (
                <ToolCatalog
                    language={settings.language}
                    onClose={() => {
                        setShowCatalog(false);
                        // Newly connected services should appear in the bot dialog.
                        if (isPipedreamConfigured()) {
                            listConnectedAccounts().then(setPipedreamAccounts).catch(() => { });
                        }
                    }}
                    onPick={modal?.kind === 'createBot' ? (slug) => {
                        setBotToolUrl(toolServerUrlFor(slug));
                        setShowCatalog(false);
                    } : undefined}
                />
            )}

            {/* Dialogs — replaces window.prompt/confirm, which browsers may block */}
            {modal && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <form
                        onSubmit={(e) => { e.preventDefault(); handleModalSubmit(); }}
                        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200"
                    >
                        <h3 className="text-lg font-bold font-display text-white mb-1">
                            {modal.kind === 'createBoard' && (t.createBoard || 'Создать доску')}
                            {modal.kind === 'createChannel' && (t.createChannel || 'Создать канал')}
                            {modal.kind === 'addHuman' && (t.addHuman || 'Добавить человека')}
                            {modal.kind === 'createBot' && (t.createBot || 'Создать бота')}
                            {modal.kind === 'cloneAgent' && (t.cloneAgent || 'Бот из персоны')}
                            {modal.kind === 'discussion' && (t.discussion || 'Совещание ботов')}
                            {modal.kind === 'deleteBoard' && (t.deleteBoard || 'Удалить доску')}
                            {modal.kind === 'deleteChannel' && (t.deleteChannel || 'Удалить канал')}
                        </h3>

                        <p className="text-slate-500 text-xs mb-4">
                            {modal.kind === 'createBoard' && (t.boardNameHint || 'Название нового пространства')}
                            {modal.kind === 'createChannel' && (t.channelNameHint || 'Название канала внутри доски')}
                            {modal.kind === 'addHuman' && (t.memberPickHint || 'Найдите человека в Потоке и добавьте в доску')}
                            {modal.kind === 'createBot' && (t.botHint || 'Бот живёт только в этой доске и отвечает на @имя. Токены тратит тот, кто его упомянул.')}
                            {modal.kind === 'cloneAgent' && (t.cloneHint || 'Копия чужой персоны в вашей доске. Автору это ничего не стоит — платит тот, кто упомянул бота.')}
                            {modal.kind === 'discussion' && (t.discussionHint || 'Боты выскажутся по очереди, по кругу. Каждый ход — один запрос к модели с вашего ключа.')}
                            {modal.kind === 'deleteBoard' && `«${modal.boardName}» — ${t.boardDeleteConfirm || 'доска, каналы и все сообщения будут удалены безвозвратно.'}`}
                            {modal.kind === 'deleteChannel' && `#${modal.channelName} — ${t.channelDeleteConfirm || 'все сообщения и вложения канала будут удалены безвозвратно, у всех участников доски.'}`}
                        </p>

                        {modal.kind === 'cloneAgent' && (
                            <div className="mb-4 max-h-44 overflow-y-auto space-y-1 border border-slate-800 rounded-lg p-2">
                                {clonable.length === 0 ? (
                                    <p className="text-[11px] text-slate-600 p-3 text-center leading-relaxed">
                                        {t.noClonable || 'Нет доступных персон. Автор должен разрешить это в настройках профиля.'}
                                    </p>
                                ) : clonable.map(profile => (
                                    <button
                                        key={profile.uid}
                                        type="button"
                                        onClick={() => {
                                            setSelectedClone(profile);
                                            setModalInput(profile.agentName);
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-md border transition-all ${selectedClone?.uid === profile.uid
                                            ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-200'
                                            : 'border-transparent text-slate-400 hover:bg-slate-800/50'
                                            }`}
                                    >
                                        <span className="text-sm block truncate">{profile.agentName}</span>
                                        <span className="text-[10px] text-slate-600 block truncate">
                                            {profile.agentRole || '—'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {modal.kind === 'discussion' && (
                            <>
                                <div className="mb-4 space-y-1 max-h-36 overflow-y-auto border border-slate-800 rounded-lg p-2">
                                    {activeBoard?.members.filter(isBot).map(bot => {
                                        const picked = discussionBots.includes(bot.id);
                                        const full = discussionBots.length >= MAX_DISCUSSION_BOTS;

                                        return (
                                            <button
                                                key={bot.id}
                                                type="button"
                                                disabled={!picked && full}
                                                onClick={() => setDiscussionBots(prev =>
                                                    picked ? prev.filter(id => id !== bot.id) : [...prev, bot.id]
                                                )}
                                                className={`w-full text-left px-3 py-2 rounded-md border transition-all disabled:opacity-30 ${picked
                                                    ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-200'
                                                    : 'border-transparent text-slate-400 hover:bg-slate-800/50'
                                                    }`}
                                            >
                                                <span className="text-sm">{picked ? '☑' : '☐'} {bot.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mb-4">
                                    <label className="block text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-2">
                                        {t.rounds || 'Кругов'}: {discussionRounds}
                                    </label>
                                    <input
                                        type="range"
                                        min={1}
                                        max={MAX_DISCUSSION_ROUNDS}
                                        value={discussionRounds}
                                        onChange={(e) => setDiscussionRounds(Number(e.target.value))}
                                        className="w-full accent-indigo-500"
                                    />
                                    <p className="text-[10px] text-slate-600 mt-1 font-mono">
                                        {discussionBots.length} × {discussionRounds} = {discussionBots.length * discussionRounds} {t.turnsTotal || 'ходов (запросов к модели)'}
                                        {toolPolicy !== 'off' && (
                                            <span className="block mt-1 text-amber-500/80">
                                                {t.withToolsUpTo || 'с инструментами — до'} {estimateDiscussionRequests(discussionBots.length, discussionRounds, MAX_REQUESTS_PER_TURN)} {t.requestsTotal || 'запросов: бот может несколько раз сходить за данными, прежде чем ответить'}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {activeBoard?.members.some(m => discussionBots.includes(m.id) && m.toolServerUrl) && (
                                    <div className="mb-4">
                                        <label className="block text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-2">
                                            {t.toolAccess || 'Доступ к инструментам'}
                                        </label>
                                        <div className="flex space-x-1">
                                            {([
                                                ['off', t.toolsOff || 'Выключить'],
                                                ['ask', t.toolsAsk || 'С подтверждением'],
                                                ['auto', t.toolsAuto || 'Полный']
                                            ] as [ToolPolicy, string][]).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() => setToolPolicy(value)}
                                                    className={`flex-1 py-2 rounded-lg border text-[10px] font-mono uppercase tracking-wider transition-all ${toolPolicy === value
                                                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                                                        : 'border-slate-700 text-slate-500 hover:border-slate-500'
                                                        }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
                                            {toolPolicy === 'auto'
                                                ? (t.toolsAutoHint || 'Боты вызовут инструменты сами, без спроса. Это действия в ваших подключённых аккаунтах.')
                                                : toolPolicy === 'ask'
                                                    ? (t.toolsAskHint || 'Каждый вызов покажем и спросим разрешения.')
                                                    : (t.toolsOffHint || 'Боты обсудят задачу, не трогая внешние сервисы.')}
                                        </p>
                                    </div>
                                )}

                                <textarea
                                    autoFocus
                                    value={botPrompt}
                                    onChange={(e) => setBotPrompt(e.target.value)}
                                    placeholder={t.taskPlaceholder || 'Задача: собрать 3 варианта слогана для баннера и выбрать лучший, с обоснованием.'}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-xs h-24 resize-none mb-4 font-mono"
                                />
                            </>
                        )}

                        {modal.kind === 'addHuman' && (
                            <>
                                <input
                                    autoFocus
                                    type="text"
                                    value={peopleSearch}
                                    onChange={(e) => setPeopleSearch(e.target.value)}
                                    placeholder={t.searchPeople || 'Поиск по имени…'}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-sm mb-3"
                                />

                                <div className="max-h-56 overflow-y-auto space-y-1 border border-slate-800 rounded-lg p-2 mb-4">
                                    {people.length === 0 ? (
                                        <p className="text-[11px] text-slate-600 p-3 text-center">
                                            {searchingPeople ? (t.searching || 'поиск…') : (t.nobodyFound || 'Никого не нашлось')}
                                        </p>
                                    ) : people.map(profile => {
                                        const already = Boolean(activeBoard?.memberIds.includes(profile.uid));

                                        return (
                                            <button
                                                key={profile.uid}
                                                type="button"
                                                disabled={already || isSubmitting}
                                                onClick={async () => {
                                                    setIsSubmitting(true);
                                                    setError(null);
                                                    try {
                                                        await handleAddPerson(profile);
                                                        closeModal();
                                                    } catch (e) {
                                                        setError(e instanceof Error ? e.message : String(e));
                                                    } finally {
                                                        setIsSubmitting(false);
                                                    }
                                                }}
                                                className="w-full flex items-center space-x-3 px-2 py-2 rounded-lg text-left transition-colors disabled:opacity-40 hover:bg-slate-800/60"
                                            >
                                                <span className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold uppercase">
                                                    {String(profile.agentName).charAt(0)}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="text-sm text-slate-200 truncate block">{profile.agentName}</span>
                                                    <span className="text-[10px] text-slate-600 truncate block">
                                                        {already ? (t.alreadyMember || 'уже в доске') : (profile.agentRole || '')}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {!isDestructiveModal(modal) && modal.kind !== 'discussion' && modal.kind !== 'addHuman' && (
                            <input
                                ref={modalInputRef}
                                autoFocus={modal.kind !== 'cloneAgent'}
                                type="text"
                                value={modalInput}
                                onChange={(e) => setModalInput(e.target.value)}
                                placeholder={
                                    modal.kind === 'addHuman' ? 'Neo'
                                        : modal.kind === 'createChannel' ? 'general'
                                            : modal.kind === 'createBot' ? (t.botNamePlaceholder || 'Аналитик')
                                                : modal.kind === 'cloneAgent' ? (t.botNameInBoard || 'Имя в доске')
                                                    : ''
                                }
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-sm mb-4"
                            />
                        )}

                        {modal.kind === 'createBot' && (
                            <>
                                <textarea
                                    value={botPrompt}
                                    onChange={(e) => setBotPrompt(e.target.value)}
                                    placeholder={t.botPromptPlaceholder || 'Ты помогаешь команде разбирать метрики. Отвечай кратко и по делу.'}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-xs h-24 resize-none mb-4 font-mono"
                                />

                                <label className="block text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-2">
                                    {t.toolServer || 'MCP-сервер инструментов'} · {t.optional || 'необязательно'}
                                </label>

                                {isPipedreamConfigured() && (
                                    <div className="flex flex-wrap items-center gap-1 mb-2">
                                        {pipedreamAccounts.filter(a => a.appSlug).map(account => {
                                            const url = toolServerUrlFor(account.appSlug!);
                                            const picked = botToolUrl === url;

                                            return (
                                                <button
                                                    key={account.id}
                                                    type="button"
                                                    onClick={() => setBotToolUrl(picked ? '' : url)}
                                                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-all ${picked
                                                        ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                                                        : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                                        }`}
                                                >
                                                    {picked ? '✓ ' : ''}{account.appName || account.appSlug}
                                                </button>
                                            );
                                        })}

                                        <button
                                            type="button"
                                            onClick={() => setShowCatalog(true)}
                                            className="text-[10px] font-mono px-2 py-1 rounded border border-dashed border-slate-600 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300 transition-all"
                                        >
                                            + {t.chooseService || 'выбрать сервис'}
                                        </button>
                                    </div>
                                )}
                                <input
                                    type="text"
                                    value={botToolUrl}
                                    onChange={(e) => setBotToolUrl(e.target.value)}
                                    placeholder="https://mcp.deepwiki.com/mcp"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors text-xs mb-2 font-mono"
                                />
                                <p className="text-[10px] text-slate-600 mb-4 leading-relaxed">
                                    {t.toolServerHint || 'Подойдёт только сервер, разрешающий запросы из браузера (CORS). Проверено: mcp.deepwiki.com, mcp.linear.app, api.githubcopilot.com/mcp. Zapier и Composio так не умеют — им нужен сервер-посредник.'}
                                </p>
                            </>
                        )}

                        {modal.kind === 'cloneAgent' && selectedClone && (
                            <div className="mb-4 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800">
                                <span className="text-[9px] font-mono uppercase tracking-wider text-slate-600 block mb-1">
                                    {t.clonedPrompt || 'Промпт персоны'}
                                </span>
                                <p className="text-[11px] text-slate-400 line-clamp-4 leading-relaxed">
                                    {selectedClone.agentPrompt || selectedClone.agentRole || (t.emptyPrompt || 'Промпт не задан')}
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="mb-4 px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs">
                                {error}
                            </div>
                        )}

                        <div className="flex space-x-3">
                            <button
                                type="button"
                                onClick={closeModal}
                                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
                            >
                                {t.cancel || 'Отмена'}
                            </button>
                            {modal.kind !== 'addHuman' && (
                            <button
                                type="submit"
                                disabled={
                                    isSubmitting ||
                                    (modal.kind === 'discussion'
                                        ? !botPrompt.trim() || discussionBots.length === 0
                                        : !isDestructiveModal(modal) && !modalInput.trim())
                                }
                                className={`flex-1 py-2.5 rounded-xl text-white font-bold font-mono text-[10px] uppercase tracking-wider shadow-lg transition-colors disabled:opacity-40 ${isDestructiveModal(modal)
                                    ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/20'
                                    : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-900/20'
                                    }`}
                            >
                                {isSubmitting
                                    ? '...'
                                    : isDestructiveModal(modal)
                                        ? (t.delete || 'Удалить')
                                        : modal.kind === 'discussion'
                                            ? (t.start || 'Запустить')
                                            : (t.create || 'Создать')}
                            </button>
                            )}
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Boards;
