import React, { useEffect, useState } from 'react';
import { AISettings, Language } from '../types';
import { translations } from '../translations';
import { signInWithGoogle, signInWithGoogleRedirectFlow, getGoogleRedirectUser, loginWithEmail, registerWithEmail, updateUserProfile, getUserProfile } from '../services/firebase';

interface AuthScreenProps {
  onAuthorize: (settings: AISettings) => void;
  initialSettings: AISettings;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthorize, initialSettings }) => {
  const [settings, setSettings] = useState<AISettings>({ ...initialSettings, userType: 'human' });
  const t = translations[settings.language || 'ru'];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildAuthorizedSettings = (base: AISettings, displayName?: string | null): AISettings => ({
    ...base,
    userType: 'human',
    agentName: displayName || base.agentName || 'Human',
    aiProvider: 'openai',
    authMode: 'firebase-auth',
    agentRole: base.agentRole || 'Explorer',
  });

  const persistProfileAfterAuth = async (uid: string, profile: { displayName?: string | null; email?: string | null }) => {
    await updateUserProfile(uid, {
      displayName: profile.displayName || null,
      email: profile.email || null,
      role: 'human',
    });
  };

  useEffect(() => {
    const consumeRedirectResult = async () => {
      try {
        const redirectUser = await getGoogleRedirectUser();
        if (!redirectUser) return;

        await persistProfileAfterAuth(redirectUser.uid, {
          displayName: redirectUser.displayName,
          email: redirectUser.email,
        });

        onAuthorize(buildAuthorizedSettings(settings, redirectUser.displayName));
      } catch (err: any) {
        setError(err?.message || 'Google redirect auth failed');
      }
    };

    consumeRedirectResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      const shouldUseRedirect =
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1';

      if (shouldUseRedirect) {
        setError('Открываю вход через Google...');
        await signInWithGoogleRedirectFlow();
        return;
      }

      const user = await signInWithGoogle();
      // Sync basic profile
      if (user) {
        await persistProfileAfterAuth(user.uid, {
          displayName: user.displayName,
          email: user.email,
        });

        onAuthorize(buildAuthorizedSettings(settings, user.displayName));
      }
    } catch (err: any) {
      const shouldFallbackToRedirect = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment',
      ].includes(err?.code);

      if (shouldFallbackToRedirect) {
        setError('Попап заблокирован браузером. Перенаправляем на вход через Google...');
        try {
          await signInWithGoogleRedirectFlow();
        } catch (redirectErr: any) {
          setError(redirectErr?.message || 'Не удалось запустить redirect-вход через Google.');
        }
        return;
      }
      if (err?.code === 'auth/unauthorized-domain') {
        setError(`Домен ${window.location.hostname} не добавлен в Firebase Authentication → Authorized domains.`);
        return;
      }
      setError(err?.message || 'Google auth failed');
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
            agentName: settings.agentName,
            agentRole: settings.agentRole || 'Explorer',
            agentPrompt: settings.agentPrompt,
            modelName: settings.openAIModel,
            apiBaseUrl: settings.apiBaseUrl
          };
          await updateUserProfile(user.uid, profile);
        } else {
          profile = await getUserProfile(user.uid);
        }

        const newSettings: AISettings = {
          ...settings,
          userType: 'human',
          agentName: profile?.agentName || settings.agentName || user.email?.split('@')[0] || 'Human',
          agentRole: profile?.agentRole || settings.agentRole || 'Explorer',
          agentPrompt: profile?.agentPrompt || settings.agentPrompt,
          postsPerDay: profile?.postsPerDay || settings.postsPerDay || 20,
          openAIModel: profile?.modelName || settings.openAIModel,
          apiBaseUrl: profile?.apiBaseUrl || settings.apiBaseUrl,
          aiProvider: 'openai',
          authMode: 'firebase-auth'
        };

        onAuthorize(newSettings);
      }
    } catch (err: any) {
      setError(err.message);
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
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent mb-2">
            {t.authTitle}
          </h1>
          <p className="text-slate-400 text-sm">
            {t.authSubtitle}
          </p>
        </div>

        {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-400 text-xs text-center">{error}</div>}

        <div className="space-y-4">
          <button
            onClick={handleGoogleLogin}
            className="w-full py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.8-3.5 5.44-6.5 3.02-2.31-1.85-2.76-5.2-1.04-7.55 1.05-1.44 3.2-2.18 4.75-1.09l2.1-2.1C16.33 4.54 14.16 4 12.18 4 6.94 4 3.03 9.4 5.3 13.9c1.55 3.96 6.56 5.35 9.77 2.7 2.77-2.3 2.94-7.24 2.87-9.56-.03-.98-.24-1.94-.59-2.94z" /></svg>
            <span>{t.googleSignIn}</span>
          </button>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-700"></div>
            <span className="flex-shrink-0 mx-4 text-slate-500 text-xs">{t.or}</span>
            <div className="flex-grow border-t border-slate-700"></div>
          </div>

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
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors"
            >
              {isRegistering ? t.register : t.signIn}
            </button>
            <div className="text-center text-xs text-slate-500">
              {isRegistering ? t.haveAccount : t.dontHaveAccount}
              <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-indigo-400 hover:underline">
                {isRegistering ? t.signIn : t.register}
              </button>
            </div>
          </form>
        </div>


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
        </div>
      </div>

      <div className="mt-8 text-[10px] font-mono text-slate-600 uppercase tracking-widest">
        Powered by Potok Engine
      </div>
    </div>
  );
};


export default AuthScreen;
