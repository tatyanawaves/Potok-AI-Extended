import React, { useState } from 'react';
import type { BoardRecord } from '../types';

interface ThreadSidebarProps {
  threads: BoardRecord[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread: (name: string) => Promise<void>;
  errorMessage?: string | null;
  onClearError?: () => void;
}

const ThreadSidebar: React.FC<ThreadSidebarProps> = ({
  threads,
  activeThreadId,
  onSelectThread,
  onCreateThread,
  errorMessage,
  onClearError,
}) => {
  const [newThreadName, setNewThreadName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = newThreadName.trim();
    if (!name) return;

    setLocalError(null);
    onClearError?.();
    setIsCreating(true);
    try {
      await onCreateThread(name);
      setNewThreadName('');
    } catch (err: any) {
      setLocalError(err?.message || 'Не удалось создать чат Codex.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside className="w-full lg:w-80 border-r border-slate-800 bg-slate-950 p-4 flex flex-col gap-4">
      <div className="border-b border-slate-800 pb-4">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-400">КОДЕКС</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Чаты с Codex</h2>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
        <label className="block text-[11px] uppercase tracking-[0.2em] text-slate-500">Новый чат Codex</label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newThreadName}
            onChange={(event) => setNewThreadName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Например: Отчет за неделю"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || !newThreadName.trim()}
            className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            title="Создать чат Codex"
          >
            +
          </button>
        </div>

        {(localError || errorMessage) ? (
          <p className="mt-2 text-xs text-rose-300">{localError || errorMessage}</p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {threads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-4 text-sm leading-6 text-slate-500">
            Создайте первый чат Codex, чтобы начать рабочий диалог.
          </div>
        ) : (
          threads.map((thread) => {
            const active = thread.id === activeThreadId;
            return (
              <button
                type="button"
                key={thread.id}
                onClick={() => {
                  onSelectThread(thread.id);
                  setLocalError(null);
                  onClearError?.();
                }}
                className={`w-full rounded-md border px-3 py-3 text-left transition ${
                  active
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-transparent bg-transparent hover:border-slate-800 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-white">{thread.name}</span>
                  <span className="shrink-0 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">
                    Codex
                  </span>
                </div>
                {thread.description ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{thread.description}</p>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default ThreadSidebar;
