import React from 'react';
import { BoardMessage } from '../../types';
import { RichText } from '../RichText';
import TerminalBlock from '../TerminalBlock';
import { AttachmentView } from '../Attachments';
import { ForwardButton, ForwardedLabel } from '../Forward';
import { extractCodeFiles, CodeFile } from '../../services/codeSave';
import { runnableBlocks, parseTerminalCommand } from '../../services/terminal';
import { formatTokens, formatCost } from '../../services/usage';

/** One message in a board channel: author, marks, text, files, terminal, tools, model. */

interface MessageItemProps {
    msg: BoardMessage;
    author: { name: string, via?: string };
    /** Whether the server signed this bot reply (services/botSignature). */
    signature?: 'signed' | 'unsigned';
    /** "#channel · board", credited when the message is forwarded. */
    place: string;
    canDelete: boolean;
    isRunning: boolean;
    language: string;
    t: any;
    onViewProfile: (name: string, id?: string) => void;
    onSaveCode: (files: CodeFile[]) => void;
    onRunCode: (msg: BoardMessage) => void;
    onDelete: (msg: BoardMessage) => void;
    onOpenImage: (url: string, name: string) => void;
    /** Below the message, e.g. its thread summary. */
    children?: React.ReactNode;
}

const MessageItem: React.FC<MessageItemProps> = ({
    msg, author, signature, place, canDelete, isRunning, language, t,
    onViewProfile, onSaveCode, onRunCode, onDelete, onOpenImage, children
}) => (
            <div className="group flex space-x-3">
                <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${msg.authorType === 'agent'
                    ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}>
                    {(Array.from(String(author.name).replace(/^\P{L}+/u, ''))[0] || '?').toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline space-x-2">
                        <button
                            onClick={() => onViewProfile(author.name, msg.authorId)}
                            className={`text-sm font-bold hover:underline ${msg.authorType === 'agent' ? 'text-indigo-300' : 'text-slate-200'}`}
                        >
                            {author.name}
                        </button>
                        {signature === 'signed' && (
                            <span className="text-[10px] text-emerald-400/80" title={t.signedHint || 'Ответ записан и подписан сервером'}>✓</span>
                        )}
                        {signature === 'unsigned' && (
                            <span className="text-[10px] text-amber-300/90" title={t.unsignedHint || 'Сервер не подписывал это сообщение: его мог написать кто угодно от имени бота'}>⚠ {t.unsigned || 'не подтверждено'}</span>
                        )}
                        {author.via && (
                            <span className="text-[10px] text-slate-500" title={t.postedByHint || 'Кто на самом деле отправил это сообщение'}>
                                {t.via || 'через'} {author.via}
                            </span>
                        )}
                        {msg.authorType === 'agent' && (
                            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-400 border border-indigo-500/20">
                                AI
                            </span>
                        )}
                        <span className="text-[10px] text-slate-600 font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.content.includes('```') && (
                            <button
                                onClick={() => onSaveCode(extractCodeFiles(msg.content))}
                                className="text-[11px] text-slate-500 hover:text-cyan-300 md:opacity-0 md:group-hover:opacity-100"
                                title={t.saveCode || 'Сохранить код'}
                            >
                                💾
                            </button>
                        )}
                        {runnableBlocks(msg.content).length > 0 && (
                            <button
                                onClick={() => onRunCode(msg)}
                                disabled={isRunning}
                                className="text-[11px] text-slate-500 hover:text-emerald-300 md:opacity-0 md:group-hover:opacity-100 disabled:opacity-40"
                                title={t.runInSandbox || 'Запустить в облачной песочнице'}
                            >
                                ▶
                            </button>
                        )}
                        <ForwardButton
                            title={t.forward || 'Переслать'}
                            className="md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                            payload={() => ({
                                text: msg.content,
                                attachments: msg.attachments,
                                // A copy of a copy still credits the original author.
                                origin: msg.forwardedFrom || {
                                    kind: 'board',
                                    authorName: msg.authorName,
                                    authorId: msg.authorId,
                                    place,
                                    timestamp: msg.timestamp
                                }
                            })}
                        />
                        {canDelete && (
                            <button
                                onClick={() => onDelete(msg)}
                                className="text-slate-700 hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-[10px]"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    {msg.forwardedFrom && (
                        <div className="mt-1 -mb-0.5">
                            <ForwardedLabel origin={msg.forwardedFrom} language={language} />
                        </div>
                    )}
                    {/* A /sh, /py or /js message is its terminal: the command
                        is already at the prompt there, so only the command
                        word is shown here. The text stays stored, for bots
                        and for forwarding. */}
                    <div className={`text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed mt-0.5 ${msg.forwardedFrom ? 'border-l-2 border-cyan-500/30 pl-2' : ''}`}>
                        {msg.terminal?.length && parseTerminalCommand(msg.content)
                            ? msg.content.trim().split(/\s/)[0]
                            : <RichText text={msg.content} />}
                    </div>

                    {msg.attachments?.map(a => (
                        <AttachmentView
                            key={a.key}
                            attachment={a}
                            failedLabel={t.downloadFailed || 'не удалось открыть'}
                            saveLabel={t.saveFile || 'скачать'}
                            onOpen={(url, at) => onOpenImage(url, at.name)}
                        />
                    ))}
                    {msg.terminal?.length ? <TerminalBlock entries={msg.terminal} /> : null}
                    {msg.toolsUsed?.some(tool => !(msg.terminal?.length && tool.startsWith('sandbox_'))) ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {msg.toolsUsed.filter(tool => !(msg.terminal?.length && tool.startsWith('sandbox_'))).map(tool => (
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
                            {msg.costUsd ? ` · ${formatCost(msg.costUsd)}` : ''}
                        </div>
                    )}
                    {children}
                </div>
            </div>
);

export default MessageItem;
