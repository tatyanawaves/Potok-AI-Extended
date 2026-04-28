import React, { useMemo, useState } from 'react';
import type { BoardMessage, BoardRecord, OrchestratorPlan } from '../types';
import type { PipedreamConnectionStatus } from '../services/pipedream';

interface MessageThreadViewProps {
  thread: BoardRecord | null;
  messages: BoardMessage[];
  currentUserName: string;
  isSending: boolean;
  orchestratorPlan: OrchestratorPlan | null;
  freelancerStatus: PipedreamConnectionStatus;
  isConnectingFreelancer: boolean;
  onConnectFreelancer: () => Promise<void>;
  onRefreshIntegrations: () => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
  errorMessage?: string | null;
  onClearError?: () => void;
}

const MessageThreadView: React.FC<MessageThreadViewProps> = ({
  thread,
  messages,
  currentUserName,
  isSending,
  orchestratorPlan,
  freelancerStatus,
  isConnectingFreelancer,
  onConnectFreelancer,
  onRefreshIntegrations,
  onSendMessage,
  errorMessage,
  onClearError,
}) => {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const activeTitle = thread?.name || 'Выберите тред';

  const planLabel = useMemo(() => {
    if (!orchestratorPlan) return 'Codex ждёт контекст';
    if (orchestratorPlan.needsUserAuth) return 'Нужно подключить сервис';
    if (orchestratorPlan.needsApproval) return 'Нужно подтверждение';
    return 'Готово к исполнению';
  }, [orchestratorPlan]);

  const freelancerStatusLabel = useMemo(() => {
    if (freelancerStatus === 'connected') return 'Freelancer подключен';
    if (freelancerStatus === 'pending') return 'Ожидаем подключение';
    if (freelancerStatus === 'error') return 'Нужно проверить Connect';
    return 'Freelancer не подключен';
  }, [freelancerStatus]);

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content || !thread) return;

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
    <section className="flex-1 min-w-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] bg-slate-950">
      <div className="min-w-0 flex flex-col">
        <div className="border-b border-slate-800 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Message thread</p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-white">{activeTitle}</h1>
            </div>
            {thread?.codexEnabled ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Codex active
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
              {thread ? 'Начните рабочий диалог.' : 'Выберите или создайте тред.'}
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-3xl rounded-lg border px-4 py-3 ${
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

        <div className="border-t border-slate-800 px-6 py-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <label className="block text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Message as {currentUserName}
            </label>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={thread?.codexEnabled ? 'Опишите задачу обычным языком...' : 'Напишите сообщение...'}
              className="mt-3 min-h-24 w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-100 outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!thread || !draft.trim() || isSending}
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? 'Sending...' : thread?.codexEnabled ? 'Send to Codex' : 'Send'}
              </button>
            </div>
            {(localError || errorMessage) ? (
              <p className="mt-3 text-xs text-rose-300">{localError || errorMessage}</p>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="hidden xl:flex min-w-0 flex-col border-l border-slate-800 bg-slate-950 px-4 py-4">
        <div className="border-b border-slate-800 pb-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Orchestrator</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{planLabel}</h2>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto space-y-3">
          <div className={`rounded-lg border p-3 ${
            freelancerStatus === 'connected'
              ? 'border-emerald-500/25 bg-emerald-500/10'
              : 'border-cyan-500/20 bg-cyan-500/5'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Pipedream Connect</p>
                <h3 className="mt-1 text-sm font-semibold text-white">{freelancerStatusLabel}</h3>
              </div>
              <span className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                freelancerStatus === 'connected'
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : 'bg-slate-800 text-slate-300'
              }`}>
                freelancer
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Codex сможет искать проекты, читать контекст Freelancer и готовить отклики через OAuth без ключей в браузере.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onConnectFreelancer}
                disabled={isConnectingFreelancer}
                className="rounded-md bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {freelancerStatus === 'connected' ? 'Переподключить' : isConnectingFreelancer ? 'Открываю...' : 'Подключить'}
              </button>
              <button
                type="button"
                onClick={onRefreshIntegrations}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Обновить
              </button>
            </div>
          </div>

          {orchestratorPlan ? (
            <>
              <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm leading-6 text-slate-300">
                {orchestratorPlan.summary}
              </p>
              {orchestratorPlan.steps.map((step) => (
                <div key={step.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                    <span className="rounded bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                      {step.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{step.reasoning}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em]">
                    <span className="rounded bg-cyan-500/10 px-2 py-1 text-cyan-300">{step.provider}</span>
                    {step.requiresApproval ? (
                      <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">approval</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-4 text-sm leading-6 text-slate-500">
              План появится после первых сообщений в треде.
            </div>
          )}
        </div>
      </aside>
    </section>
  );
};

export default MessageThreadView;
