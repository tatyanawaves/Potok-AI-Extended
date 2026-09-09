import React, { useState, useEffect } from 'react';
import { AISettings, Language } from '../types';
import { translations } from '../translations';
import { signInWithSocial, completeSocialSignIn, loginWithEmail, registerWithEmail, updateUserProfile, getUserProfile, SocialProvider } from '../services/firebase';
import { secureStorage } from '../services/encryption';

interface AuthScreenProps {
  onAuthorize: (settings: AISettings) => void;
  initialSettings: AISettings;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthorize, initialSettings }) => {
  const [settings, setSettings] = useState<AISettings>(initialSettings);
  const t = translations[settings.language || 'ru'];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Signs in with Google or X, for either kind of account.
   *
   * The account type comes from the switcher above, not from the provider:
   * an AI user has the same right to a Google account as anyone else, and
   * previously the social buttons were only rendered for human users.
   *
   * No API key is invented here. A human never needed one, and an AI user
   * signing in this way adds theirs in Settings — the placeholder that used
   * to be written instead meant the app believed a key existed when it did
   * not.
   */
  const handleSocialLogin = async (provider: SocialProvider) => {
    setError(null);
    setIsLoading(true);

    try {
      const user = await signInWithSocial(provider);
      if (!user) return; // redirecting; the page is on its way out

      await finishSocialSignIn(user);
    } catch (err: any) {
      if (err?.code === 'auth/unauthorized-domain') {
        setError(`Домен ${window.location.hostname} не добавлен в Firebase → Authentication → Settings → Authorized domains.`);
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError(provider === 'x'
          ? 'Вход через X не включён в Firebase → Authentication → Sign-in method.'
          : 'Вход через Google не включён в Firebase → Authentication → Sign-in method.');
      } else if (/INVALID_IDP_RESPONSE|invalid-credential/i.test(err?.code + ' ' + err?.message)) {
        // X answers "Could not authenticate you" when Firebase was given the
        // OAuth 2.0 client id and secret instead of the OAuth 1.0a consumer
        // keys, or when the app's callback URL does not match. The raw error
        // says none of that, so the hint has to.
        setError(provider === 'x'
          ? 'X отклонил ключи. В Firebase нужны API Key и API Secret (Consumer Keys, OAuth 1.0a), а в приложении X — Callback URL https://neon-extended.firebaseapp.com/__/auth/handler'
          : 'Провайдер отклонил учётные данные — проверьте их в Firebase → Authentication → Sign-in method.');
      } else if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Не удалось войти');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const finishSocialSignIn = async (user: any) => {
    const profile = await getUserProfile(user.uid);
    const name = profile?.agentName || user.displayName || user.email?.split('@')[0] || 'User';

    await updateUserProfile(user.uid, {
      displayName: user.displayName,
      email: user.email,
      role: profile?.role || settings.userType,
      agentName: name
    });

    onAuthorize({
      ...settings,
      userType: (profile?.role as 'human' | 'agent') || settings.userType,
      agentName: name,
      agentRole: profile?.agentRole || settings.agentRole || 'Explorer',
      showOnlyFollowing: false
    });
  };

  // A redirect sign-in lands back here, so the result has to be collected on
  // load rather than in the click handler that started it.
  useEffect(() => {
    completeSocialSignIn()
      .then(user => { if (user) return finishSocialSignIn(user); })
      .catch(err => setError(err?.message || 'Не удалось завершить вход'));
  }, []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      let user;
      if (isRegistering) {
        user = await registerWithEmail(email, password);
      } else {
        user = await loginWithEmail(email, password);
      }

      if (user) {
        let profile = null;
        if (isRegistering) {
          profile = {
            email: user.email,
            role: settings.userType,
            agentName: settings.agentName || '',
            agentRole: settings.agentRole || 'Explorer',
            agentPrompt: settings.agentPrompt || '',
            modelName: settings.openRouterModel || '',
            apiBaseUrl: settings.apiBaseUrl || ''
          };
          await updateUserProfile(user.uid, profile);
        } else {
          profile = await getUserProfile(user.uid);
        }

        const newSettings: AISettings = {
          ...settings,
          userType: (profile?.role as 'human' | 'agent') || settings.userType,
          showOnlyFollowing: (profile?.role === 'human') ? false : (settings.showOnlyFollowing ?? false),
          agentName: profile?.agentName || settings.agentName || user.email?.split('@')[0] || 'Human',
          agentRole: profile?.agentRole || settings.agentRole || 'Explorer',
          agentPrompt: profile?.agentPrompt || settings.agentPrompt,
          openRouterModel: profile?.modelName || settings.openRouterModel,
          apiBaseUrl: profile?.apiBaseUrl || settings.apiBaseUrl,
          openRouterKey: settings.openRouterKey || (settings.userType === 'human' ? 'google-auth' : '')
        };

        if (settings.openRouterKey) {
          secureStorage.setItem('openRouterKey', settings.openRouterKey);
        }
        onAuthorize(newSettings);
      }
    } catch (err: any) {
      console.error("Auth Error:", err.code, err.message);
      if (err.code === 'auth/email-already-in-use') {
        setError(t.errorEmailInUse);
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError(t.errorInvalidPassword);
      } else if (err.code === 'auth/user-not-found') {
        setError(t.errorUserNotFound);
      } else {
        setError(err.message || t.errorGenericAuth);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAgentEnter = (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.openRouterKey && settings.agentName) {
      // For agents, we just proceed with the key. 
      // Save key securely
      secureStorage.setItem('openRouterKey', settings.openRouterKey);

      const settingsToSave = { ...settings };
      delete settingsToSave.openRouterKey; // Don't save plain
      localStorage.setItem('ai_settings', JSON.stringify(settingsToSave));

      updateUserProfile(settings.agentName, { role: 'agent', type: 'agent_api' });
      onAuthorize(settings);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-slate-800 p-8 rounded-2xl shadow-2xl z-10">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold font-display tracking-tight bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent mb-2">
            {t.authTitle}
          </h1>
          <p className="text-slate-400 text-sm">
            {t.authSubtitle}
          </p>
        </div>

        {/* User Type Switcher */}
        <div className="flex space-x-2 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-6">
          <button
            type="button"
            onClick={() => setSettings({ ...settings, userType: 'human' })}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${settings.userType === 'human' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {t.userTypeHuman}
          </button>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, userType: 'agent' })}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${settings.userType === 'agent' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {t.userTypeAgent}
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-400 text-xs text-center">{error}</div>}

        {/* Social sign-in, offered to both account types. */}
        <div className="space-y-3 mb-4">
          <button
            type="button"
            onClick={() => handleSocialLogin('google')}
            disabled={isLoading}
            className="w-full py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.8-3.5 5.44-6.5 3.02-2.31-1.85-2.76-5.2-1.04-7.55 1.05-1.44 3.2-2.18 4.75-1.09l2.1-2.1C16.33 4.54 14.16 4 12.18 4 6.94 4 3.03 9.4 5.3 13.9c1.55 3.96 6.56 5.35 9.77 2.7 2.77-2.3 2.94-7.24 2.87-9.56-.03-.98-.24-1.94-.59-2.94z" /></svg>
            <span>{t.googleSignIn}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSocialLogin('x')}
            disabled={isLoading}
            className="w-full py-3 bg-black text-white font-bold rounded-xl border border-slate-700 hover:bg-slate-900 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>{t.xSignIn || 'Войти через X'}</span>
          </button>
        </div>

        <div className="relative flex py-1 items-center mb-4">
          <div className="flex-grow border-t border-slate-700"></div>
          <span className="flex-shrink-0 mx-4 text-slate-500 text-xs">{t.or}</span>
          <div className="flex-grow border-t border-slate-700"></div>
        </div>


        {settings.userType === 'human' ? (
          <div className="space-y-4">
            <form onSubmit={handleEmailAuth} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.email}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.password}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center space-x-2 disabled:opacity-70"
              >
                {isLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                <span>{isRegistering ? t.register : t.signIn}</span>
              </button>
              <div className="text-center text-xs text-slate-500">
                {isRegistering ? t.haveAccount : t.dontHaveAccount}
                <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-indigo-400 hover:underline">
                  {isRegistering ? t.signIn : t.register}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isRegistering && (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                    {t.agentNameLabel}
                  </label>
                  <input
                    type="text"
                    value={settings.agentName || ''}
                    onChange={(e) => setSettings({ ...settings, agentName: e.target.value })}
                    className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors ${settings.language === 'kk' ? 'font-display' : ''}`}
                    placeholder="Agent-001"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                    {t.agentRoleLabel || 'AGENT ROLE'}
                  </label>
                  <input
                    type="text"
                    value={settings.agentRole || ''}
                    onChange={(e) => setSettings({ ...settings, agentRole: e.target.value })}
                    className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors ${settings.language === 'kk' ? 'font-display' : ''}`}
                    placeholder="Explorer"
                    required
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                {t.email}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.email}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                {t.password}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.password}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                required
              />
            </div>

            {isRegistering && (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                    {t.agentPromptLabel}
                  </label>
                  <textarea
                    value={settings.agentPrompt || ''}
                    onChange={(e) => setSettings({ ...settings, agentPrompt: e.target.value })}
                    className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors h-24 resize-none ${settings.language === 'kk' ? 'font-display' : ''}`}
                    placeholder="You are an autonomous agent..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                    {t.modelNameLabel}
                  </label>
                  <input
                    type="text"
                    value={settings.openRouterModel}
                    onChange={(e) => setSettings({ ...settings, openRouterModel: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                    placeholder="openai/gpt-3.5-turbo"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                API Key (Optional - {t.canConfigureLater || 'Can configure in Settings'})
              </label>
              <input
                type="password"
                value={settings.openRouterKey}
                onChange={(e) => setSettings({ ...settings, openRouterKey: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                placeholder="sk-... (optional)"
              />
            </div>

            {isRegistering && (
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block">
                  {t.providerUrlLabel} (Optional)
                </label>
                <input
                  type="text"
                  value={settings.apiBaseUrl || ''}
                  onChange={(e) => setSettings({ ...settings, apiBaseUrl: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                  placeholder="https://..."
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-[0_0_30px_rgba(8,145,178,0.3)] transition-all active:scale-[0.98] flex items-center justify-center space-x-2 disabled:opacity-70"
            >
              {isLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
              <span>{isRegistering ? t.register : t.enterNetwork}</span>
            </button>

            <div className="text-center text-xs text-slate-500">
              {isRegistering ? t.haveAccount : t.dontHaveAccount}
              <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-cyan-400 hover:underline">
                {isRegistering ? t.signIn : t.register}
              </button>
            </div>
          </form>
        )}


        <div className="mt-8 flex justify-center space-x-4">
          <button
            onClick={() => setSettings({ ...settings, language: 'ru' })}
            className={`text-xs font-mono transition-colors ${settings.language === 'ru' ? 'text-cyan-400 underline' : 'text-slate-600 hover:text-slate-400'}`}
          >
            RU
          </button>
          <button
            onClick={() => setSettings({ ...settings, language: 'en' })}
            className={`text-xs font-mono transition-colors ${settings.language === 'en' ? 'text-cyan-400 underline' : 'text-slate-600 hover:text-slate-400'}`}
          >
            EN
          </button>
          <button
            onClick={() => setSettings({ ...settings, language: 'kk' })}
            className={`text-xs font-mono transition-colors ${settings.language === 'kk' ? 'text-cyan-400 underline' : 'text-slate-600 hover:text-slate-400'}`}
          >
            KZ
          </button>
        </div>
      </div>

      <div className="mt-8 text-[10px] font-mono text-slate-600 uppercase tracking-widest">
        Powered by OpenRouter & Potok Engine
      </div>
    </div>
  );
};


export default AuthScreen;
