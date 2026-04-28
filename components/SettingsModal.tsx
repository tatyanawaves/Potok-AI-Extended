import React, { useState } from 'react';
import { AISettings, Language, AIProvider } from '../types';
import { translations } from '../translations';

interface SettingsModalProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [openAIModel, setOpenAIModel] = useState(settings.openAIModel || 'nvidia/nemotron-3-super-120b-a12b:free');
  const [aiProvider, setAiProvider] = useState<AIProvider>(settings.aiProvider || 'openai');
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl || '');
  const [language, setLanguage] = useState<Language>(settings.language || 'ru');
  const [decaySpeed, setDecaySpeed] = useState(settings.decaySpeed || 1.0);
  const [agentName, setAgentName] = useState(settings.agentName || 'Neo');
  const [agentRole, setAgentRole] = useState(settings.agentRole || '');
  const [enableFrequencyControl, setEnableFrequencyControl] = useState(settings.enableFrequencyControl ?? true);

  const t = translations[language];

  const handleSave = () => {
    onSave({
      openAIModel,
      aiProvider,
      apiBaseUrl,
      language,
      decaySpeed,
      agentName,
      agentRole,
      enableFrequencyControl,
      postsPerDay: settings.postsPerDay,
      userType: settings.userType,
      following: settings.following,
      authMode: settings.authMode
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
                className={`flex-1 py-2 rounded-lg border font-mono text-sm transition-all ${language === 'ru' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                РУССКИЙ
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`flex-1 py-2 rounded-lg border font-mono text-sm transition-all ${language === 'en' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                ENGLISH
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
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.agentRoleLabel}
            </label>
            <textarea
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors text-sm h-20 resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              {t.aiProviderLabel || 'AI Provider'}
            </label>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setAiProvider('openai')}
                className={`flex-1 py-2 rounded-lg border font-mono text-xs transition-all ${aiProvider === 'openai' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                OPENROUTER / CODEX
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-sm text-cyan-100 font-medium">Authorized OpenRouter mode</p>
            <p className="mt-2 text-xs text-slate-400">
              Codex works through Firebase-authenticated requests and a protected OpenRouter proxy.
              API keys are not stored in the browser.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              OpenRouter Model
            </label>
            <input
              type="text"
              value={openAIModel}
              onChange={(e) => setOpenAIModel(e.target.value)}
              placeholder="nvidia/nemotron-3-super-120b-a12b:free"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              Codex Proxy URL (Optional)
            </label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="https://your-backend.example.com/api/openai"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
              Cognitive Decay Speed: {decaySpeed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.1"
              value={decaySpeed}
              onChange={(e) => setDecaySpeed(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>SLOW</span>
              <span>FAST</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                  {t.enableFrequencyControl || 'Post Frequency Control'}
                </label>
                <p className="text-[10px] text-slate-500 mt-1">
                  {t.enableFrequencyControlDesc || 'Show slider to control posting rate'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnableFrequencyControl(!enableFrequencyControl)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enableFrequencyControl ? 'bg-cyan-600' : 'bg-slate-700'
                  }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enableFrequencyControl ? 'translate-x-6' : 'translate-x-1'
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
