import React, { useEffect, useRef } from 'react';
import { BoardMessage } from '../../types';

/**
 * A thread: the message it hangs from, the replies under it, and a box to
 * reply. Bots mentioned here answer here.
 */

interface ThreadPanelProps {
    root: BoardMessage | null;
    replies: BoardMessage[];
    draft: string;
    busy: boolean;
    t: any;
    renderMessage: (message: BoardMessage) => React.ReactNode;
    onDraft: (value: string) => void;
    onSend: () => void;
    onClose: () => void;
}

const ThreadPanel: React.FC<ThreadPanelProps> = ({ root, replies, draft, busy, t, renderMessage, onDraft, onSend, onClose }) => {
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [replies.length]);

    return (
        <aside className="absolute lg:relative inset-y-0 right-0 z-20 w-full max-w-md lg:w-96 shrink-0 border-l border-slate-800 bg-slate-900 lg:bg-slate-900/30 flex flex-col shadow-2xl lg:shadow-none">
            <div className="p-4 border-b border-slate-800 font-mono text-[10px] uppercase tracking-widest text-cyan-300/80 flex items-center justify-between">
                <span>{t.thread || 'Ветка'} · {replies.length}</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white" title={t.close || 'Закрыть'}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
                {root ? (
                    <div className="pb-3 border-b border-slate-800">{renderMessage(root)}</div>
                ) : (
                    <p className="text-xs text-slate-500">{t.threadRootMissing || 'Исходное сообщение не найдено — возможно, оно удалено или старше загруженных.'}</p>
                )}
                {replies.map(reply => <React.Fragment key={reply.id}>{renderMessage(reply)}</React.Fragment>)}
                <div ref={end} />
            </div>

            <div className="shrink-0 border-t border-slate-800 p-3 flex gap-2">
                <textarea
                    value={draft}
                    onChange={e => onDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                    placeholder={t.replyInThread || 'Ответить в ветке · @бот'}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 resize-none h-[42px] max-h-32"
                />
                <button
                    onClick={onSend}
                    disabled={busy || !draft.trim()}
                    className="px-3 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-40"
                >
                    {t.send || 'Отпр.'}
                </button>
            </div>
        </aside>
    );
};

export default ThreadPanel;
