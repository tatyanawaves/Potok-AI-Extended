import React, { useState, useEffect, useCallback } from 'react';
import { AISettings, Language } from '../types';
import { DEFAULT_MODEL, DEFAULT_BASE_URL, embed } from '../services/llm';
import { translations } from '../translations';
import { isPipedreamConfigured, listConnectedAccounts, ConnectedAccount } from '../services/pipedream';
import ToolCatalog from './ToolCatalog';
import {
  saveSandboxKey, sandboxKeyStatus, deleteSandboxKey, SandboxProvider, SANDBOX_NAMES,
  saveGcpKey, gcpConnected, GCP_REGIONS
} from '../services/connectors';

interface SettingsModalProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [openRouterKey, setOpenRouterKey] = useState(settings.openRouterKey || '');
  const [openRouterModel, setOpenRouterModel] = useState(settings.openRouterModel || DEFAULT_MODEL);
  const [memoryModel, setMemoryModel] = useState(settings.memoryModel || '');
  const [embeddingModel, setEmbeddingModel] = useState(settings.embeddingModel || '');
  const [githubToken, setGithubToken] = useState(settings.githubToken || '');

  // Sandbox keys go straight to the server; the page only learns whether one is set.
  const [sandboxKeys, setSandboxKeys] = useState<Record<SandboxProvider, boolean>>({ e2b: false, daytona: false });
  const [sandboxDraft, setSandboxDraft] = useState<Record<SandboxProvider, string>>({ e2b: '', daytona: '' });
  const [sandboxMessage, setSandboxMessage] = useState<string | null>(null);
  useEffect(() => { if (isPipedreamConfigured()) sandboxKeyStatus().then(setSandboxKeys).catch(() => { }); }, []);

  // Google Cloud: a service-account JSON key, sent to the server and not kept here.
  const [gcpSet, setGcpSet] = useState(false);
  const [gcpJson, setGcpJson] = useState('');
  const [gcpRegion, setGcpRegion] = useState('europe-west1');
  const [gcpMessage, setGcpMessage] = useState<string | null>(null);
  useEffect(() => { if (isPipedreamConfigured()) gcpConnected().then(setGcpSet).catch(() => { }); }, []);

  const storeGcpKey = async () => {
    setGcpMessage('…');
    try {
      await saveGcpKey(gcpJson.trim(), gcpRegion);
      setGcpSet(true);
      setGcpJson('');
      setGcpMessage('Проект подключён: доступ к Cloud Run проверен');
    } catch (e) {
      setGcpMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const storeSandboxKey = async (provider: SandboxProvider) => {
    setSandboxMessage('…');
    try {
      await saveSandboxKey(provider, sandboxDraft[provider].trim());
      setSandboxKeys(prev => ({ ...prev, [provider]: true }));
      setSandboxDraft(prev => ({ ...prev, [provider]: '' }));
      setSandboxMessage(`${SANDBOX_NAMES[provider]}: ключ проверен и сохранён`);
    } catch (e) {
      setSandboxMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const [embeddingCheck, setEmbeddingCheck] = useState<{ ok: boolean, text: string } | null>(null);

  /** One tiny request, so a wrong model name shows up here and not as silent keyword search. */
  const checkEmbeddings = async () => {
    setEmbeddingCheck({ ok: true, text: '…' });
    try {
      const [vector] = await embed(['проверка'], { ...settings, openRouterKey, apiBaseUrl, embeddingModel } as AISettings);
      setEmbeddingCheck({ ok: true, text: `работает · ${vector.length} измерений` });
    } catch (e) {
      setEmbeddingCheck({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
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
  const [showCatalog, setShowCatalog] = useState(false);

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

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const t = translations[language];

  const handleSave = () => {
    onSave({
      openRouterKey,
      openRouterModel,
      aiProvider: 'openrouter',
      memoryModel: memoryModel.trim() || undefined,
      embeddingModel: embeddingModel.trim() || undefined,
      githubToken: githubToken.trim(),
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

  if (showCatalog) {
    return (
      <ToolCatalog
        language={language}
        onClose={() => { setShowCatalog(false); refreshAccounts(); }}
      />
    );
  }

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

          {/* One OpenAI-compatible API for everything. Shown to every account,
              not only to AI users: whoever @mentions a board bot pays for its
              answer, and a human had nowhere to put a key. */}
          <>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {t.apiHint || 'Любой OpenAI-совместимый API: OpenRouter по умолчанию, либо Groq, Gemini, OpenAI, локальная модель — укажите их адрес ниже.'}
              </p>
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      {t.apiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={openRouterKey === 'google-auth' ? '' : openRouterKey}
                      onChange={(e) => setOpenRouterKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      {t.modelLabel || 'Модель'}
                    </label>
                    <input
                      type="text"
                      value={openRouterModel}
                      onChange={(e) => setOpenRouterModel(e.target.value)}
                      placeholder="author/model:free"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      {t.memoryModelLabel || 'Модель для служебных задач'} ({t.optional || 'необязательно'})
                    </label>
                    <input
                      type="text"
                      value={memoryModel}
                      onChange={(e) => setMemoryModel(e.target.value)}
                      placeholder={t.memoryModelPlaceholder || 'та же, что выше'}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      {t.memoryModelHint || 'Сжатие памяти, план и проверки совещаний. Дешёвая быстрая модель здесь экономит токены, не трогая ответы ботов.'}
                    </p>
                  </div>

                  {isPipedreamConfigured() && (
                    <div className="space-y-2">
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                        {(t as any).sandboxKeysLabel || 'Песочницы кода (ваш ключ)'}
                      </label>
                      {(['e2b', 'daytona'] as SandboxProvider[]).map(provider => (
                        <div key={provider} className="flex gap-2 items-center">
                          <span className="w-16 text-[11px] font-mono text-slate-400 shrink-0">{SANDBOX_NAMES[provider]}</span>
                          {sandboxKeys[provider] ? (
                            <>
                              <span className="flex-1 text-[11px] text-emerald-400">✓ {(t as any).keySaved || 'ключ сохранён'}</span>
                              <button type="button" onClick={() => deleteSandboxKey(provider).then(() => setSandboxKeys(prev => ({ ...prev, [provider]: false })))}
                                className="text-[10px] font-mono text-slate-500 hover:text-rose-300">{(t as any).remove || 'удалить'}</button>
                            </>
                          ) : (
                            <>
                              <input type="password" value={sandboxDraft[provider]}
                                onChange={(e) => setSandboxDraft(prev => ({ ...prev, [provider]: e.target.value }))}
                                placeholder={provider === 'e2b' ? 'e2b_…' : 'dtn_…'}
                                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs" />
                              <button type="button" disabled={!sandboxDraft[provider].trim()} onClick={() => storeSandboxKey(provider)}
                                className="px-2 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-mono uppercase disabled:opacity-40">
                                {(t as any).saveShort || 'Сохранить'}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {sandboxMessage && <p className="text-[10px] text-slate-400">{sandboxMessage}</p>}
                      <p className="text-[10px] text-slate-600 leading-relaxed">
                        {(t as any).sandboxKeysHint || 'Боты запускают код, команды и работают с файлами в вашей облачной песочнице — вы платите провайдеру напрямую. Ключ проверяется и хранится зашифрованным на сервере Potok, в браузере не остаётся. Ключ: e2b.dev/dashboard или app.daytona.io → API Keys.'}
                      </p>
                    </div>
                  )}

                  {isPipedreamConfigured() && (
                    <div className="space-y-2">
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                        {(t as any).gcpLabel || 'Google Cloud Run (ваш проект)'}
                      </label>
                      {gcpSet ? (
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-[11px] text-emerald-400">✓ {(t as any).gcpConnected || 'проект подключён'}</span>
                          <button type="button" onClick={() => deleteSandboxKey('gcp').then(() => setGcpSet(false))}
                            className="text-[10px] font-mono text-slate-500 hover:text-rose-300">{(t as any).remove || 'удалить'}</button>
                        </div>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <label className="flex-1 text-center cursor-pointer px-2 py-1.5 rounded-lg border border-dashed border-slate-600 text-[11px] text-slate-400 hover:border-slate-400">
                              {gcpJson ? '✓ JSON-ключ загружен' : ((t as any).pickKeyFile || 'Выбрать JSON-ключ…')}
                              <input type="file" accept=".json,application/json" className="hidden"
                                onChange={async (e) => { const f = e.target.files?.[0]; if (f) setGcpJson(await f.text()); e.target.value = ''; }} />
                            </label>
                            <select value={gcpRegion} onChange={(e) => setGcpRegion(e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 text-[11px] font-mono text-slate-200">
                              {GCP_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button type="button" disabled={!gcpJson} onClick={storeGcpKey}
                              className="px-2 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-mono uppercase disabled:opacity-40">
                              {(t as any).connect || 'Подключить'}
                            </button>
                          </div>
                        </>
                      )}
                      {gcpMessage && <p className="text-[10px] text-slate-400 break-words">{gcpMessage}</p>}
                      <p className="text-[10px] text-slate-600 leading-relaxed">
                        {(t as any).gcpHint || 'Боты разворачивают сервисы в вашем проекте Google Cloud — оплата идёт с вашего аккаунта. Создайте сервисный аккаунт (роли: Cloud Run Admin, Cloud Build Editor, Storage Admin, Artifact Registry Administrator, Service Account User), включите API run, cloudbuild, artifactregistry, storage и загрузите его JSON-ключ. Ключ хранится зашифрованным на сервере Potok.'}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      {t.githubTokenLabel || 'Токен GitHub (сохранение кода)'}
                    </label>
                    <input
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="github_pat_..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                    />
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      {t.githubTokenHint || 'Fine-grained токен с правом Contents: Read and write на нужные репозитории. Хранится только в этом браузере.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      {t.embeddingModelLabel || 'Модель эмбеддингов (поиск по смыслу)'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={embeddingModel}
                        onChange={(e) => { setEmbeddingModel(e.target.value); setEmbeddingCheck(null); }}
                        placeholder="openai/text-embedding-3-small"
                        className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={checkEmbeddings}
                        disabled={!embeddingModel.trim() || !openRouterKey}
                        className="px-3 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-mono uppercase disabled:opacity-40"
                      >
                        {t.check || 'Проверить'}
                      </button>
                    </div>
                    {embeddingCheck && (
                      <p className={`text-[10px] leading-relaxed ${embeddingCheck.ok ? 'text-emerald-400/90' : 'text-rose-300'}`}>
                        {embeddingCheck.text}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      {t.embeddingModelHint || 'Боты находят заметки по смыслу, а не только по словам. Тот же API и ключ; копейки за запрос. Пусто — поиск по словам. OpenRouter/OpenAI: text-embedding-3-small, Gemini: gemini-embedding-001. У Groq эмбеддингов нет.'}
                    </p>
                  </div>

              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.apiAddressLabel || 'Адрес API'} ({t.optional || 'необязательно'})
                </label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
                />
              </div>
          </>

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

              <button
                type="button"
                onClick={() => setShowCatalog(true)}
                className="w-full py-2.5 rounded-lg bg-emerald-950/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono uppercase tracking-wider hover:bg-emerald-900/30 transition-colors"
              >
                ⚒ {t.browseTools || 'Каталог сервисов'}
              </button>

              {accountsError && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-[11px]">
                  {accountsError}
                </div>
              )}
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