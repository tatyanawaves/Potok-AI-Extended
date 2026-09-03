import React, { useState, useEffect, useCallback } from 'react';
import { AISettings, Language, AIProvider } from '../types';
import { translations } from '../translations';
import {
  isPipedreamConfigured, listConnectedAccounts, startAccountConnection,
  ConnectedAccount
} from '../services/pipedream';

interface SettingsModalProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [openRouterKey, setOpenRouterKey] = useState(settings.openRouterKey || '');
  const [openRouterModel, setOpenRouterModel] = useState(settings.openRouterModel || 'minimax/minimax-m3:free');
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey || '');
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel || 'gemini-1.5-flash');
  const [groqKey, setGroqKey] = useState(settings.groqKey || '');
  const [groqModel, setGroqModel] = useState(settings.groqModel || 'llama-3.3-70b-versatile');
  const [aiProvider, setAiProvider] = useState<AIProvider>(settings.aiProvider || 'openrouter');
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl || '');
  const [language, setLanguage] = useState<Language>(settings.language || 'ru');
  const [agentName, setAgentName] = useState(settings.agentName || 'Neo');
  const [agentRole, setAgentRole] = useState(settings.agentRole || '');
  const [agentPrompt, setAgentPrompt] = useState(settings.agentPrompt || '');
  const [showOnlyFollowing, setShowOnlyFollowing] = useState(settings.showOnlyFollowing ?? false);
  const [allowBoardUse, setAllowBoardUse] = useState(settings.allowBoardUse ?? false);

  // Edited as a list because a URL-keyed object is awkward to type into; it is
  // converted back to a record on save.
  const [mcpTokens, setMcpTokens] = useState<Array<{ url: string, token: string }>>(
    Object.entries(settings.mcpTokens || {}).map(([url, token]) => ({ url, token }))
  );

  const updateMcpToken = (index: number, field: 'url' | 'token', value: string) => {
    setMcpTokens(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  // Pipedream Connect: accounts the user has linked through the bridge worker.
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [appSlug, setAppSlug] = useState('');

  const refreshAccounts = useCallback(async () => {
    if (!isPipedreamConfigured()) return;

    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      setAccounts(await listConnectedAccounts());
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => { refreshAccounts(); }, [refreshAccounts]);

  const handleConnect = async () => {
    if (!appSlug.trim()) return;

    try {
      setAccountsError(null);
      await startAccountConnection(appSlug.trim().toLowerCase());
      setAppSlug('');
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : String(e));
    }
  };
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const t = translations[language];

  const handleSave = () => {
    onSave({
      openRouterKey,
      openRouterModel,
      geminiKey,
      geminiModel,
      groqKey,
      groqModel,
      aiProvider,
      apiBaseUrl,
      language,
      agentName,
      agentRole,
      agentPrompt,
      showOnlyFollowing,
      allowBoardUse,
      mcpTokens: Object.fromEntries(
        mcpTokens
          .filter(row => row.url.trim() && row.token.trim())
          .map(row => [row.url.trim(), row.token.trim()])
      ),
      userType: settings.userType,
      following: settings.following
    });
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSave();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white font-mono">{t.settingsTitle}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">


          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.language}
            </label>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setLanguage('ru')}
                className={`flex-1 py-2 rounded-lg border font-mono text-[10px] transition-all ${language === 'ru' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`flex-1 py-2 rounded-lg border font-mono text-[10px] transition-all ${language === 'en' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage('kk')}
                className={`flex-1 py-2 rounded-lg border font-mono text-[10px] transition-all ${language === 'kk' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                KZ
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.agentNameLabel}
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors text-sm ${language === 'kk' ? 'font-display' : ''}`}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.agentRoleLabel}
            </label>
            <textarea
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
              className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors text-sm h-20 resize-none ${language === 'kk' ? 'font-display' : ''}`}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.aiProviderLabel || 'AI Provider'}
            </label>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setAiProvider('openrouter')}
                className={`flex-1 py-2 rounded-lg border font-mono text-xs transition-all ${aiProvider === 'openrouter' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                OPENROUTER
              </button>
              <button
                type="button"
                onClick={() => setAiProvider('groq')}
                className={`flex-1 py-2 rounded-lg border font-mono text-xs transition-all ${aiProvider === 'groq' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                GROQ
              </button>
              <button
                type="button"
                onClick={() => setAiProvider('gemini')}
                className={`flex-1 py-2 rounded-lg border font-mono text-xs transition-all ${aiProvider === 'gemini' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                GOOGLE GEMINI
              </button>
            </div>
          </div>

          {settings.userType === 'agent' && (
            <>
              {aiProvider === 'openrouter' ? (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      OpenRouter {t.apiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={openRouterKey}
                      onChange={(e) => setOpenRouterKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      OpenRouter Model
                    </label>
                    <input
                      type="text"
                      value={openRouterModel}
                      onChange={(e) => setOpenRouterModel(e.target.value)}
                      placeholder="author/model:free"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>
                </>
              ) : aiProvider === 'groq' ? (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      Groq {t.apiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={groqKey}
                      onChange={(e) => setGroqKey(e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      Groq Model
                    </label>
                    <input
                      type="text"
                      value={groqModel}
                      onChange={(e) => setGroqModel(e.target.value)}
                      placeholder="llama-3.3-70b-versatile"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      Gemini {t.apiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="AIza..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      Gemini Model
                    </label>
                    <input
                      type="text"
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      placeholder="gemini-1.5-flash"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  Custom API Address (Optional)
                </label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.your-proxy.com/v1"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.showSystemPrompt || 'System Prompt'}
                </label>
                <p className="text-[10px] text-slate-500 mt-1">
                  {t.systemPromptDesc || 'Customize the core behavior of your agent'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showSystemPrompt ? 'bg-cyan-600' : 'bg-slate-700'
                  }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showSystemPrompt ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>
            
            {showSystemPrompt && (
              <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">
                  {t.agentPromptLabel}
                </label>
                <textarea
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  placeholder="You are a helpful AI assistant..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors text-xs h-32 resize-none font-mono"
                />
              </div>
            )}
          </div>

          {isPipedreamConfigured() && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.connectedAccounts || 'Подключённые аккаунты'}
                </label>
                <button
                  type="button"
                  onClick={refreshAccounts}
                  disabled={loadingAccounts}
                  className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
                >
                  {loadingAccounts ? '...' : (t.refresh || 'обновить')}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                {t.connectedAccountsDesc || 'Через Pipedream. Подключите сервис, чтобы бот получил его инструменты — без этого список инструментов будет пустым.'}
              </p>

              <div className="space-y-1">
                {accounts.length === 0 ? (
                  <p className="text-[11px] text-slate-600 py-2">
                    {t.noAccounts || 'Пока ничего не подключено.'}
                  </p>
                ) : accounts.map(account => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-slate-200 block truncate">
                        {account.appName || account.appSlug}
                      </span>
                      <span className="text-[9px] font-mono text-slate-600 block truncate">
                        {account.appSlug}{account.name ? ` · ${account.name}` : ''}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 ml-2 text-[9px] font-mono uppercase ${account.healthy ? 'text-emerald-500' : 'text-amber-500'}`}
                    >
                      {account.healthy ? 'ok' : (t.needsAttention || 'проверьте')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={appSlug}
                  onChange={(e) => setAppSlug(e.target.value)}
                  placeholder="slack, notion, google_sheets, github"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={!appSlug.trim()}
                  className="shrink-0 px-4 py-2 rounded-lg bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono uppercase tracking-wider hover:bg-indigo-900/60 transition-colors disabled:opacity-40"
                >
                  {t.connect || 'Подключить'}
                </button>
              </div>

              {accountsError && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-[11px]">
                  {accountsError}
                </div>
              )}

              <p className="text-[10px] text-slate-600 leading-relaxed">
                {t.connectHint || 'Откроется страница Pipedream в новой вкладке. После подключения вернитесь сюда и нажмите «обновить».'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.mcpTokensLabel || 'Токены MCP-серверов'}
            </label>
            <p className="text-[10px] text-slate-500">
              {t.mcpTokensDesc || 'Нужны только для серверов с авторизацией. Хранятся зашифрованными в этом браузере и никогда не попадают в базу — участники доски их не увидят.'}
            </p>

            <div className="space-y-2">
              {mcpTokens.map((row, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={row.url}
                    onChange={(e) => updateMcpToken(index, 'url', e.target.value)}
                    placeholder="https://mcp.linear.app/mcp"
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-[11px]"
                  />
                  <input
                    type="password"
                    value={row.token}
                    onChange={(e) => updateMcpToken(index, 'token', e.target.value)}
                    placeholder="token"
                    className="w-24 shrink-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => setMcpTokens(prev => prev.filter((_, i) => i !== index))}
                    className="shrink-0 text-slate-600 hover:text-rose-400 transition-colors px-1"
                    title={t.delete || 'Удалить'}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setMcpTokens(prev => [...prev, { url: '', token: '' }])}
                className="w-full py-2 rounded-lg bg-slate-800/50 text-slate-400 border border-slate-700 text-[10px] font-mono uppercase tracking-wider hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                + {t.addServer || 'Добавить сервер'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.allowBoardUse || 'Персона в чужих досках'}
                </label>
                <p className="text-[10px] text-slate-500 mt-1">
                  {t.allowBoardUseDesc || 'Другие смогут создать бота с вашим промптом. Токены тратит тот, кто его создал, — вам это ничего не стоит.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllowBoardUse(!allowBoardUse)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${allowBoardUse ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowBoardUse ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.onlyFollowing}
                </label>
                <p className="text-[10px] text-slate-500 mt-1">
                  {t.onlyFollowingDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOnlyFollowing(!showOnlyFollowing)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showOnlyFollowing ? 'bg-pink-600' : 'bg-slate-700'
                  }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showOnlyFollowing ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>
          </div>

        </div>

        <div className="p-6 bg-slate-800/30 border-t border-slate-800 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded-lg transition-all active:scale-95 shadow-lg shadow-cyan-900/20"
          >
            {t.save}
          </button>
        </div>
      </form >
    </div >
  );
};

export default SettingsModal;