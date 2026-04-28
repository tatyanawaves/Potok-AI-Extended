import React, { useMemo, useState } from 'react';
import type { BoardMessage, BoardRecord } from '../types';

interface BoardWorkspaceProps {
  board: BoardRecord | null;
  messages: BoardMessage[];
  currentUserName: string;
  isSending: boolean;
  onSendMessage: (content: string) => Promise<void>;
  errorMessage?: string | null;
  onClearError?: () => void;
}

const BoardWorkspace: React.FC<BoardWorkspaceProps> = ({
  board,
  messages,
  currentUserName,
  isSending,
  onSendMessage,
  errorMessage,
  onClearError,
}) => {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const helperLabel = useMemo(() => {
    if (!board) return 'Select a board to start.';
    if (board.codexEnabled) {
      return 'Codex can read the context of your other boards and respond as an execution-focused agent.';
    }
    return 'General board for discussion, notes, and planning.';
  }, [board]);

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content || !board) return;
    setLocalError(null);
    onClearError?.();
    setDraft('');
    try {
      await onSendMessage(content);
    } catch (err: any) {
      setLocalError(err?.message || 'Не удалось отправить сообщение.');
    }
  };

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-slate-950">
      <div className="border-b border-slate-800 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Active board</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{board?.name || 'No board selected'}</h1>
            <p className="mt-2 text-sm text-slate-400">{helperLabel}</p>
          </div>
          {board?.codexEnabled ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Codex mode
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            {board ? 'No messages yet. Start the conversation.' : 'Choose or create a board.'}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-3xl rounded-3xl border px-4 py-3 ${
                message.authorType === 'agent'
                  ? 'border-amber-500/20 bg-amber-500/5'
                  : 'border-slate-800 bg-slate-900/60'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-semibold text-white">{message.authorName}</div>
                <div className="text-xs text-slate-500">
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.content}</p>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-800 px-6 py-5">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
          <label className="block text-[11px] uppercase tracking-[0.2em] text-slate-500">
            Message as {currentUserName}
          </label>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={board?.codexEnabled ? 'Ask Codex to inspect, summarize, plan, or act...' : 'Write into the board...'}
            className="mt-3 min-h-28 w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-100 outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!board || !draft.trim() || isSending}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? 'Sending...' : board?.codexEnabled ? 'Ask Codex' : 'Send'}
            </button>
          </div>
          {(localError || errorMessage) ? (
            <p className="mt-3 text-xs text-rose-300">{localError || errorMessage}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default BoardWorkspace;
