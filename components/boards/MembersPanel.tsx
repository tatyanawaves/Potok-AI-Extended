import React from 'react';
import { Board, BoardMember } from '../../types';
import { isBot } from '../../services/mentions';
import { toolServersOf } from '../../services/runtime/turn';
import type { SavedBot } from '../../services/botLibrary';

/** The members of a board, and for its owner the ways to add bots and people. */

type Modal = { kind: 'createBot' } | { kind: 'library' } | { kind: 'cloneAgent' } | { kind: 'addHuman' } | { kind: 'editBot', botId: string, botName: string };

interface MembersPanelProps {
    activeBoard: Board;
    currentUid?: string;
    savedBots: SavedBot[];
    t: any;
    onClose: () => void;
    onViewProfile: (name: string, id?: string) => void;
    onSaveBot: (member: BoardMember) => void;
    onRemove: (member: BoardMember) => void;
    openModal: (modal: Modal) => void;
}

const MembersPanel: React.FC<MembersPanelProps> = ({ activeBoard, currentUid, savedBots, t, onClose, onViewProfile, onSaveBot, onRemove, openModal }) => (
    <aside className="absolute lg:relative inset-y-0 right-0 z-20 w-full max-w-xs md:w-64 shrink-0 border-l border-slate-800 bg-slate-900 lg:bg-slate-900/30 flex flex-col shadow-2xl lg:shadow-none overflow-y-auto">
        <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-slate-400 flex items-center justify-between">
            {t.members || 'Участники'}
            <button
                onClick={onClose}
                className="text-slate-500 hover:text-white"
                title={t.close || 'Закрыть'}
            >
                ✕
            </button>
        </div>

        <div className="flex-1 p-2 space-y-1">
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
                        {toolServersOf(member).length > 0 && (
                            <span
                                className="text-[9px] font-mono text-emerald-500/70 block truncate"
                                title={toolServersOf(member).join('\n')}
                            >
                                ⚒ {toolServersOf(member).map(u => { try { return new URL(u).hostname; } catch { return u; } }).join(', ')}
                            </span>
                        )}
                    </div>

                    {isBot(member) && (
                        <button
                            onClick={() => onSaveBot(member)}
                            className={`${savedBots.some(b => b.name.toLowerCase() === member.name.toLowerCase()) ? 'text-amber-300/80' : 'text-slate-600 md:opacity-0 md:group-hover:opacity-100'} hover:text-amber-200 transition-opacity shrink-0 mr-2 text-xs`}
                            title={t.saveBotHint || 'Сохранить в «Мои боты» — чтобы добавлять его в другие доски'}
                        >
                            {savedBots.some(b => b.name.toLowerCase() === member.name.toLowerCase()) ? '★' : '☆'}
                        </button>
                    )}
                    {activeBoard.ownerId === currentUid && isBot(member) && (
                        <button
                            onClick={() => openModal({ kind: 'editBot', botId: member.id, botName: member.name })}
                            className="text-slate-600 hover:text-indigo-300 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 mr-2 text-xs"
                            title={t.editBot || 'Изменить бота'}
                        >
                            ✎
                        </button>
                    )}
                    {activeBoard.ownerId === currentUid && member.role !== 'owner' && (
                        <button
                            onClick={() => onRemove(member)}
                            className="text-slate-600 hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
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
                    onClick={() => openModal({ kind: 'library' })}
                    className="w-full py-2 rounded-lg bg-amber-900/10 text-amber-200/90 border border-amber-500/20 text-[10px] font-mono uppercase tracking-wider hover:bg-amber-900/30 transition-colors"
                >
                    + {t.fromMyBots || 'Из моих ботов'}{savedBots.length ? ` (${savedBots.length})` : ''}
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
);

export default MembersPanel;
