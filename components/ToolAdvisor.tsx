import React, { useEffect, useState } from 'react';
import { AISettings, BoardMember } from '../types';
import { translations } from '../translations';
import { addBot, updateBot } from '../services/boards';
import { designBot, toolServersOf } from '../services/boardAgent';
import { freeName } from '../services/mentions';
import { startAccountConnection } from '../services/pipedream';
import { collectCandidates, startOAuthConnection, ToolCandidate } from '../services/connectors';
import { adviseTools, generateMcpServer, Suggestion } from '../services/runtime/advisor';
import { CodeFile } from '../services/codeSave';

/**
 * The orchestrator's advice before a task: which tools the team lacks, and a
 * button for each fix — connect and attach a tool, create a bot from a
 * prompt, or generate a custom MCP server to save and deploy.
 */

interface ToolAdvisorProps {
    task: string;
    bots: BoardMember[];
    boardId: string;
    ownerId: string;
    settings: AISettings;
    onCodeFiles: (files: CodeFile[]) => void;
    /** A bot the advisor created, so an open meeting can include it. */
    onBotCreated?: (name: string) => void;
    onClose: () => void;
}

/** A readable name for a tool server; a malformed URL must not break the advice. */
const hostOf = (url: string): string => {
    try { return new URL(url).host; } catch { return url; }
};

const ToolAdvisor: React.FC<ToolAdvisorProps> = ({ task, bots, boardId, ownerId, settings, onCodeFiles, onBotCreated, onClose }) => {
    const t = translations[settings.language] as any;
    const [candidates, setCandidates] = useState<ToolCandidate[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<Record<number, string>>({});
    const [busy, setBusy] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const found = await collectCandidates(task);
                setCandidates(found);
                const byUrl = new Map(found.map(c => [c.url, c.name]));
                const advice = await adviseTools(task, bots.map(b => ({
                    name: b.name,
                    persona: b.systemPrompt || '',
                    tools: toolServersOf(b).map(u => byUrl.get(u) || hostOf(u))
                })), found, settings);
                // Advice to attach what a bot already has is noise.
                setSuggestions(advice.filter(s => {
                    if (s.type !== 'attach') return true;
                    const bot = bots.find(b => b.name === s.bot);
                    const url = found.find(c => c.id === s.toolId)?.url;
                    return !(bot && url && toolServersOf(bot).includes(url));
                }));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const candidate = (id: string) => candidates.find(c => c.id === id);

    /** Starts the sign-in a tool needs; the user comes back and adds it. */
    const connect = async (c: ToolCandidate) => {
        if (c.kind === 'oauth') await startOAuthConnection(c.target!);
        else if (c.kind === 'pipedream') await startAccountConnection(c.target!);
        else if (c.kind === 'gcp') throw new Error('Добавьте ключ сервисного аккаунта Google Cloud в Настройках → «Google Cloud Run»');
        else if (c.kind === 'sandbox') throw new Error(`Добавьте свой ключ ${c.name.replace('Песочница ', '')} в Настройках → «Песочницы кода»`);
    };

    const act = async (index: number, action: () => Promise<string>) => {
        setBusy(index);
        setError(null);
        try {
            setDone(prev => ({ ...prev, [index]: '' }));
            const text = await action();
            setDone(prev => ({ ...prev, [index]: text }));
        } catch (e) {
            setDone(prev => { const next = { ...prev }; delete next[index]; return next; });
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    };

    const card = 'p-3 rounded-lg border border-slate-800 bg-slate-950/50 space-y-2';
    const btn = 'px-2.5 py-1 rounded-md border text-[10px] font-mono uppercase tracking-wider disabled:opacity-40';

    return (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto space-y-3">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-lg font-bold font-display text-white">🧩 {t.toolAdvisor || 'Подбор инструментов'}</h3>
                        <p className="text-[11px] text-slate-500 line-clamp-2">{task}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
                </div>

                {!suggestions && !error && (
                    <p className="text-xs text-slate-500">{t.advisorThinking || 'Оркестратор смотрит на задачу, ботов и доступные коннекторы…'}</p>
                )}
                {error && <p className="text-xs text-rose-300">{error}</p>}
                {suggestions && suggestions.length === 0 && (
                    <p className="text-xs text-emerald-300/80">{t.advisorNothing || 'Команде хватает инструментов для этой задачи.'}</p>
                )}

                {suggestions?.map((s, i) => {
                    const doneText = done[i];
                    if (s.type === 'attach') {
                        const c = candidate(s.toolId)!;
                        const bot = bots.find(b => b.name === s.bot)!;
                        return (
                            <div key={i} className={card}>
                                <div className="text-sm text-slate-200">⚒ {c.name} → {bot.name}</div>
                                <p className="text-[11px] text-slate-500">{s.reason}</p>
                                <div className="flex gap-2 flex-wrap">
                                    {c.needsConnection && (
                                        <button className={`${btn} border-amber-500/40 text-amber-300`} disabled={busy !== null}
                                            onClick={() => act(i, async () => { await connect(c); return 'Войдите в открывшемся окне, затем нажмите «Добавить»'; })}>
                                            {t.connect || 'Подключить'}
                                        </button>
                                    )}
                                    <button className={`${btn} border-emerald-500/40 text-emerald-300`} disabled={busy !== null}
                                        onClick={() => act(i, async () => {
                                            // Merged at write time: this bot's list may have changed
                                            // since the advice was drawn up.
                                            await updateBot(boardId, bot.id, { addToolServerUrls: [c.url] });
                                            return `Добавлено боту ${bot.name}`;
                                        })}>
                                        {t.add || 'Добавить'}
                                    </button>
                                </div>
                                {doneText && <p className="text-[11px] text-emerald-400">{doneText}</p>}
                            </div>
                        );
                    }
                    if (s.type === 'create_bot') {
                        const tools = s.toolIds.map(candidate).filter(Boolean) as ToolCandidate[];
                        return (
                            <div key={i} className={card}>
                                <div className="text-sm text-slate-200">🤖 {s.description}</div>
                                <p className="text-[11px] text-slate-500">{s.reason}{tools.length ? ` · ⚒ ${tools.map(c => c.name).join(', ')}` : ''}</p>
                                <div className="flex gap-2 flex-wrap">
                                    {tools.filter(c => c.needsConnection).map(c => (
                                        <button key={c.id} className={`${btn} border-amber-500/40 text-amber-300`} disabled={busy !== null}
                                            onClick={() => act(i, async () => { await connect(c); return `Войдите в ${c.name}, затем создайте бота`; })}>
                                            {t.connect || 'Подключить'} {c.name}
                                        </button>
                                    ))}
                                    <button className={`${btn} border-indigo-500/40 text-indigo-200`} disabled={busy !== null}
                                        onClick={() => act(i, async () => {
                                            const design = await designBot(s.description, settings);
                                            const name = freeName(design.name, bots.map(b => b.name));
                                            await addBot(boardId, {
                                                name, systemPrompt: design.systemPrompt, ownerId,
                                                toolServerUrls: tools.map(c => c.url)
                                            });
                                            onBotCreated?.(name);
                                            return `Бот @${name} создан`;
                                        })}>
                                        {t.createBot || 'Создать бота'}
                                    </button>
                                </div>
                                {doneText && <p className="text-[11px] text-emerald-400">{doneText}</p>}
                            </div>
                        );
                    }
                    return (
                        <div key={i} className={card}>
                            <div className="text-sm text-slate-200">🛠 {t.customMcp || 'Свой MCP-сервер'}: {s.spec.name}</div>
                            <p className="text-[11px] text-slate-500">{s.reason}</p>
                            <p className="text-[10px] font-mono text-slate-600">{s.spec.tools.map(tool => tool.name).join(', ')}</p>
                            <button className={`${btn} border-cyan-500/40 text-cyan-200`} disabled={busy !== null}
                                onClick={() => act(i, async () => {
                                    onCodeFiles(await generateMcpServer(s.spec, settings));
                                    return 'Код сервера готов — сохраните его и разверните по README';
                                })}>
                                {busy === i ? '…' : (t.generateCode || 'Сгенерировать код')}
                            </button>
                            {doneText && <p className="text-[11px] text-emerald-400">{doneText}</p>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ToolAdvisor;
