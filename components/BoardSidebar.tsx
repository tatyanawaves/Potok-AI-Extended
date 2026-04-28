import React, { useState } from 'react';
import type { BoardRecord } from '../types';

interface BoardSidebarProps {
  boards: BoardRecord[];
  activeBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => Promise<void>;
  onToggleCodex: (boardId: string, enabled: boolean) => Promise<void>;
  errorMessage?: string | null;
  onClearError?: () => void;
}

const BoardSidebar: React.FC<BoardSidebarProps> = ({
  boards,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onToggleCodex,
  errorMessage,
  onClearError,
}) => {
  const [newBoardName, setNewBoardName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = newBoardName.trim();
    if (!name) return;
    setLocalError(null);
    onClearError?.();
    setIsCreating(true);
    try {
      await onCreateBoard(name);
      setNewBoardName('');
    } catch (err: any) {
      setLocalError(err?.message || 'Не удалось создать доску.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleCodex = async (boardId: string, enabled: boolean) => {
    setLocalError(null);
    onClearError?.();
    try {
      await onToggleCodex(boardId, enabled);
    } catch (err: any) {
      setLocalError(err?.message || 'Не удалось переключить Codex.');
    }
  };

  return (
    <aside className="w-full max-w-xs border-r border-slate-800 bg-slate-950/70 backdrop-blur-xl p-4 flex flex-col gap-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-400">Boards</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Workspace</h2>
        <p className="mt-1 text-sm text-slate-400">Google-authenticated boards with one dedicated Codex board.</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <label className="block text-[11px] uppercase tracking-[0.2em] text-slate-500">Create board</label>
        <input
          type="text"
          value={newBoardName}
          onChange={(event) => setNewBoardName(event.target.value)}
          placeholder="New board name"
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="mt-3 w-full rounded-xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
        >
          {isCreating ? 'Creating...' : 'Create'}
        </button>

        {(localError || errorMessage) ? (
          <p className="mt-2 text-xs text-rose-300">{localError || errorMessage}</p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {boards.map((board) => {
          const active = board.id === activeBoardId;
          return (
            <div
              key={board.id}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                active
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onSelectBoard(board.id);
                    setLocalError(null);
                    onClearError?.();
                  }}
                  className="font-medium text-white hover:text-cyan-200 transition"
                >
                  {board.name}
                </button>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                    board.codexEnabled
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {board.codexEnabled ? 'codex' : board.kind}
                </span>
              </div>
              {board.description ? (
                <p className="mt-2 text-sm text-slate-400 line-clamp-2">{board.description}</p>
              ) : null}

              <button
                type="button"
                onClick={() => handleToggleCodex(board.id, !board.codexEnabled)}
                className={`mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  board.codexEnabled
                    ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {board.codexEnabled ? 'Отключить Codex' : 'Подключить Codex'}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
};

export default BoardSidebar;
