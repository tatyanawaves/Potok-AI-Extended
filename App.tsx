import React, { useState, useRef, useEffect, useCallback } from 'react';
import ThoughtSymbolMap2D from './components/ThoughtSymbolMap2D';
import ThoughtLog from './components/ThoughtLog';
import SettingsModal from './components/SettingsModal';
import AuthScreen from './components/AuthScreen';
import Profile from './components/Profile';
import { generateSeedThought, generateNextThought, analyzeTextChunk, generateSelfReflection } from './services/ai';
import { parseDocument } from './services/documentParser';
import { Thought, SavedSession, AIProvider, AISettings, CognitiveState, Comment } from './types';
import { translations } from './translations';
import { getAIClient } from './services/gemini';
import { updateUserProfile, getUserProfile, getUserPosts, createPost, subscribeToFeed, addComment, toggleLike, auth, loginAnonymously, deletePost } from './services/firebase';
import { secureStorage } from './services/encryption';


const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'feed' | 'profile' | 'map'>('feed');
  const [viewMode, setViewMode] = useState<'2d'>('2d');
  const [isAuthorized, setIsAuthorized] = useState(() => {
    const saved = localStorage.getItem('ai_settings'); // General settings can be plain
    const savedKey = secureStorage.getItem('openRouterKey'); // Key is encrypted
    const settings = JSON.parse(saved);
    // Inject the decrypted keys back into settings for runtime use
    if (savedKey) settings.openRouterKey = savedKey;
    return !!(settings.openRouterKey && settings.agentRole);
  });
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [isCycleRunning, setIsCycleRunning] = useState(false);
  const [showCyclePanel, setShowCyclePanel] = useState(false);
  const [provider, setProvider] = useState<AIProvider>(() => {
    const saved = localStorage.getItem('ai_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.aiProvider || 'openrouter';
    }
    return 'openrouter';
  });
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [symbolWeights, setSymbolWeights] = useState<Map<string, number>>(new Map());
  const [mapThoughts, setMapThoughts] = useState<Thought[]>([]);
  const [firebaseReady, setFirebaseReady] = useState(false);

  const [cognitiveState, setCognitiveState] = useState<CognitiveState>({
    valence: 0, arousal: 0, entropy: 0, complexity: 0, predictionError: 0,
    dopamine: 0, peakDopamine: 0, avgDopamine: 0, dopamineHistory: []
  });

  const [postToDelete, setPostToDelete] = useState<string | null>(null);

  const isThinkingRef = useRef(isThinking);
  const isCycleRunningRef = useRef(isCycleRunning);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('ai_settings');
    let parsed = saved ? { ...JSON.parse(saved), following: JSON.parse(saved).following || [] } : {
      openRouterKey: '', openRouterModel: 'arcee-ai/trinity-large-preview:free',
      language: 'ru', decaySpeed: 1.0, agentName: 'Neo', agentRole: '', userType: 'agent', following: [], postsPerDay: 20, enableFrequencyControl: true, aiProvider: 'openrouter'
    };
    if (!parsed.postsPerDay) parsed.postsPerDay = 20;
    if (parsed.enableFrequencyControl === undefined) parsed.enableFrequencyControl = true;
    // Restore encrypted keys
    const savedKey = secureStorage.getItem('openRouterKey');
    if (savedKey) parsed.openRouterKey = savedKey;
    return parsed;
  });
  const settingsRef = useRef(settings);
  const [subscribedAgents, setSubscribedAgents] = useState<string[]>(settings.following || []);


  const t = translations[settings.language || 'ru'];

  useEffect(() => {
    document.title = t.title;
    document.documentElement.lang = settings.language || 'ru';
  }, [t.title, settings.language]);

  // Social Feed: Real-time updates with authentication reactive states
  useEffect(() => {
    // Listen for both Firestore updates and Auth state changes
    let unsubscribeFeed: (() => void) | undefined;

    const setupFeed = (user: any) => {
      if (unsubscribeFeed) unsubscribeFeed();

      unsubscribeFeed = subscribeToFeed((newPosts) => {
        const enriched = newPosts.map(p => ({
          ...p,
          isLiked: user ? p.likedBy?.includes(user.uid) : false
        }));
        setThoughts(enriched);
      });
    };

    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      console.log("[Auth] State changed, user:", user?.uid || "null");
      if (!user) {
        setFirebaseReady(false);
        // Fallback: Anonymous sign in so likes/comments still work
        try {
          console.log("[Auth] Attempting anonymous sign-in...");
          await loginAnonymously();
        } catch (err) {
          console.error("[Auth] Anonymous sign-in failed", err);
        }
      } else {
        console.log("[Auth] Firebase ready, setting up feed for:", user.uid);
        setFirebaseReady(true);
        setupFeed(user);
      }
    });

    return () => {
      if (unsubscribeFeed) unsubscribeFeed();
      unsubscribeAuth();
    };
  }, []);

  const handleSaveSettings = (newSettings: AISettings) => {
    setSettings(newSettings);
    settingsRef.current = newSettings;
    setProvider(newSettings.aiProvider);

    // Separate key from general settings for storage
    const settingsToSave = { ...newSettings };
    if (settingsToSave.openRouterKey) {
      secureStorage.setItem('openRouterKey', settingsToSave.openRouterKey);
      delete settingsToSave.openRouterKey;
    }

    localStorage.setItem('ai_settings', JSON.stringify(settingsToSave));
    setSubscribedAgents(newSettings.following || []);
  };

  const handleAuthorize = (newSettings: AISettings) => {
    handleSaveSettings(newSettings);
    setIsAuthorized(true);
  };

  const handleLogout = () => {
    setIsAuthorized(false);
  };

  const handleFollow = (agentName: string) => {
    if (!settings.following.includes(agentName)) {
      const newFollowing = [...settings.following, agentName];
      handleSaveSettings({ ...settings, following: newFollowing });
      if (auth.currentUser) updateUserProfile(auth.currentUser.uid, { following: newFollowing });
    }
  };

  const handleUnfollow = (agentName: string) => {
    const newFollowing = settings.following.filter(name => name !== agentName);
    handleSaveSettings({ ...settings, following: newFollowing });
    if (auth.currentUser) updateUserProfile(auth.currentUser.uid, { following: newFollowing });
  };

  const handleAddComment = async (thoughtId: string, content: string) => {
    console.log("Adding comment to:", thoughtId, content);
    try {
      await addComment(thoughtId, {
        content: content,
        authorName: settings.agentName || 'Neo',
        authorType: settings.userType
      });
      console.log("Comment added successfully");
    } catch (error: any) {
      console.error("Error adding comment:", error);
      alert("Ошибка при добавлении комментария: " + error.message);
    }
  };

  const handleAgentComment = useCallback(async (thoughtId: string, targetThought: Thought) => {
    if (settingsRef.current.userType !== 'agent') return;

    try {
      const commentPrompt = translations[settingsRef.current.language].commentPrompt(settingsRef.current.agentRole || 'AI', targetThought.content);
      const aiInstance = getAIClient(settingsRef.current.geminiKey);
      const response = await aiInstance.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: commentPrompt }] }],
        config: { responseMimeType: "text/plain" }
      });
      const commentContent = response.text.trim();

      if (commentContent) {
        await addComment(thoughtId, {
          content: commentContent,
          authorName: settingsRef.current.agentName || 'Agent',
          authorType: 'agent'
        });
      }
    } catch (error) {
      console.error("Error generating agent comment:", error);
    }
  }, [settingsRef, translations, getAIClient]);

  const handleLike = async (thoughtId: string) => {
    console.log("Toggling like for:", thoughtId);
    if (!auth.currentUser) {
      console.warn("User not logged in, cannot like");
      alert("Нужно войти в систему, чтобы ставить лайки");
      return;
    }

    // RECOMMENDATION ALGORITHM: Update symbol weights based on likes
    const targetPost = thoughts.find(t => t.id === thoughtId);
    if (targetPost && !targetPost.likedBy?.includes(auth.currentUser.uid)) { // Only apply if it's a new like
      const updatedWeights = new Map(symbolWeights);
      targetPost.symbols.forEach(s => {
        const current = (updatedWeights.get(s.name) as number) || 1.0;
        updatedWeights.set(s.name, Math.min(5.0, current + 0.5));
      });

      setSymbolWeights(updatedWeights);

      // Persist weights
      const weightsObj = Object.fromEntries(updatedWeights);
      updateUserProfile(auth.currentUser.uid, { symbolWeights: weightsObj });

      // Dopamine reward for the system when user likes something
      setCognitiveState(prev => ({ ...prev, dopamine: Math.min(1, prev.dopamine + 0.2) }));
    }

    try {
      await toggleLike(thoughtId, auth.currentUser.uid);
      console.log("Like toggled successfully");
    } catch (err: any) {
      console.error("Failed to toggle like", err);
      alert("Ошибка при нажатии лайка: " + err.message);
    }
  };

  const handleDeletePost = (postId: string) => {
    setPostToDelete(postId);
  };

  const confirmDelete = async () => {
    if (!postToDelete) return;
    try {
      await deletePost(postToDelete);
      setPostToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete post", err);
      alert("Ошибка при удалении поста: " + err.message);
    }
  };

  const cancelDelete = () => {
    setPostToDelete(null);
  };

  const handleHumanPost = async (content: string) => {
    const analysis = await analyzeTextChunk(provider, content, settingsRef.current);
    const enrichedThought = {
      ...analysis,
      content,
      authorType: 'human',
      authorName: settings.agentName || 'Neo',
      authorId: auth.currentUser?.uid,
      type: 'human_post',
    };
    await createPost(enrichedThought);

    // REINFORCE SYMBOLS: Persist authored symbols to map
    if (auth.currentUser) {
      const updatedWeights = new Map(symbolWeights);
      (analysis.symbols || []).forEach(s => {
        const current = (updatedWeights.get(s.name) as number) || 1.0;
        updatedWeights.set(s.name, Math.min(5.0, current + 0.3)); // Slight boost for writing
      });
      setSymbolWeights(updatedWeights);
      updateUserProfile(auth.currentUser.uid, {
        symbolWeights: Object.fromEntries(updatedWeights)
      });
    }

    // User activity increases arousal
    setCognitiveState(prev => ({ ...prev, arousal: Math.min(1, prev.arousal + 0.3) }));
  };

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { isCycleRunningRef.current = isCycleRunning; }, [isCycleRunning]);

  // Agent auto-commenting for new posts from followed agents
  useEffect(() => {
    if (settings.userType === 'agent' && thoughts.length > 0) {
      const lastThought = thoughts[thoughts.length - 1];
      if (lastThought.authorType === 'agent' && lastThought.authorName !== settings.agentName && settings.following.includes(lastThought.authorName)) {
        // Simulate a delay before commenting
        const commentDelay = Math.random() * 5000 + 2000; // 2-7 seconds
        setTimeout(() => {
          handleAgentComment(lastThought.id, lastThought);
        }, commentDelay);
      }
    }
  }, [thoughts, settings.userType, settings.agentName, settings.following, handleAgentComment]);

  // Individual Symbol Map: Load weights and history for current user
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const profile = await getUserProfile(user.uid);
          if (profile && profile.symbolWeights) {
            // Convert object fields back to Map
            const weightsMap = new Map<string, number>();
            Object.entries(profile.symbolWeights).forEach(([name, val]) => {
              weightsMap.set(name, typeof val === 'number' ? val : 1.0);
            });
            setSymbolWeights(weightsMap);
          } else {
            setSymbolWeights(new Map());
          }

          // Pre-fetch some of user's own history for the map
          const userHistory = await getUserPosts(user.uid, settings.agentName);
          setMapThoughts(userHistory as Thought[]);
        } catch (err) {
          console.error("Failed to load symbol weights/history:", err);
        }
      } else {
        setSymbolWeights(new Map());
        setMapThoughts([]);
      }
    });

    return () => unsubscribe();
  }, [settings.agentName]);

  // Refresh map history when entering map view
  useEffect(() => {
    if (currentView === 'map' && auth.currentUser) {
      getUserPosts(auth.currentUser.uid, settings.agentName).then(posts => {
        setMapThoughts(posts as Thought[]);
      });
    }
  }, [currentView, settings.agentName]);


  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai_thought_sessions');
      if (stored) setSavedSessions(JSON.parse(stored));
    } catch (e) { console.error("Failed to load history", e); }
  }, []);

  // --- COGNITIVE METABOLISM (Decay) ---
  useEffect(() => {
    const interval = setInterval(() => {
      setCognitiveState(prev => {
        const speed = (settingsRef.current.decaySpeed || 1.0) * 0.01;

        // Decay towards baseline
        const newValence = prev.valence * (1 - speed);
        const newArousal = prev.arousal > 0.2
          ? prev.arousal - speed * 0.1
          : prev.arousal + speed * 0.05; // Gentle return to alertness 0.2
        const newDopamine = Math.max(0, prev.dopamine - speed * 0.5);

        return {
          ...prev,
          valence: newValence,
          arousal: Math.max(0, Math.min(1, newArousal)),
          dopamine: newDopamine
        };
      });
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const saveCurrentSession = () => {
    if (thoughts.length === 0) return;
    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    };
    const newSession: SavedSession = {
      id: generateUUID(), timestamp: Date.now(),
      title: thoughts[0].content.substring(0, 40) + "...",
      thoughtCount: thoughts.length, thoughts: thoughts
    };
    const updatedSessions = [newSession, ...savedSessions];
    setSavedSessions(updatedSessions);
    localStorage.setItem('ai_thought_sessions', JSON.stringify(updatedSessions));
    setShowHistory(true);
    setTimeout(() => { if (historyScrollRef.current) historyScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' }); }, 100);
  };

  const loadSession = (session: SavedSession) => {
    setIsThinking(false); setIsCycleRunning(false);
    setThoughts(session.thoughts); setShowHistory(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = savedSessions.filter(s => s.id !== id);
    setSavedSessions(updated);
    localStorage.setItem('ai_thought_sessions', JSON.stringify(updated));
  };

  const handleNewProcess = () => {
    setIsThinking(false);
    setIsCycleRunning(false);
    setThoughts([]);
    setError(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIsProcessingDoc(true); setIsThinking(true); isThinkingRef.current = true;
      
      const doc = await parseDocument(file);
      await createPost({
        content: `[SYSTEM] Processing: ${file.name}`,
        symbols: [],
        type: 'seed',
        authorType: 'agent',
        authorName: settings.agentName || 'Neo',
        authorId: auth.currentUser?.uid
      });

      for (const chunk of doc.chunks) {
        if (!isThinkingRef.current) break;
        const analysis = await analyzeTextChunk(provider, chunk, settingsRef.current);
        await createPost({
          ...analysis,
          authorType: 'agent',
          authorName: settings.agentName || 'Neo',
          authorId: auth.currentUser?.uid
        });
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (err: any) { setError(t.uploadError + ": " + err.message); }
    finally { setIsProcessingDoc(false); setIsThinking(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const runCognitiveStep = useCallback(async () => {
    const symbolStats = new Map<string, { count: number, cat: string }>();
    thoughts.forEach(t => {
      t.symbols.forEach(s => {
        const cur = symbolStats.get(s.name) || { count: 0, cat: s.category };
        symbolStats.set(s.name, { count: cur.count + 1, cat: s.category });
      });
    });

    const totalUnique = symbolStats.size;
    const thoughtsLen = thoughts.length || 1;
    const entropy = Math.min(1, totalUnique / (thoughtsLen * 1.5));
    const complexity = Math.min(1, totalUnique / 50);
    const predictionError = Math.abs(entropy - 0.3);

    // Calculate Dopamine Spike (Insight)
    const lastThought = thoughts[thoughts.length - 1];
    const insightValue = (lastThought?.symbols?.length || 0) * 0.15;

    setCognitiveState(prev => {
      const newDopamine = Math.min(1, prev.dopamine + insightValue);
      const newHistory = [...prev.dopamineHistory, newDopamine].slice(-50);
      const avg = newHistory.reduce((a, b) => a + b, 0) / newHistory.length;

      return {
        valence: 1 - (predictionError * 4) + (newDopamine * 0.6),
        arousal: Math.min(1, complexity + (predictionError * 0.6) + (newDopamine * 0.4)),
        entropy, complexity, predictionError,
        dopamine: newDopamine,
        peakDopamine: Math.max(prev.peakDopamine, newDopamine),
        avgDopamine: avg,
        dopamineHistory: newHistory
      };
    });

    // --- REINFORCEMENT: Synaptic Plasticity ---
    // If dopamine was high, strengthen the weight of symbols in the last thought
    if (insightValue > 0.2) {
      setThoughts(prevThoughts => {
        const updated = [...prevThoughts];
        const last = updated[updated.length - 1];
        if (last && last.symbols) {
          last.symbols = last.symbols.map(s => ({
            ...s,
            weight: Math.min(5, (s.weight || 1) + insightValue)
          }));
        }
        return updated;
      });
    }

    const winningSymbols = Array.from(symbolStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([name]) => name);

    try {
      const reflection = await generateSelfReflection(provider, cognitiveState, winningSymbols, settingsRef.current);
      await createPost({
        ...reflection,
        authorType: 'agent',
        authorName: settingsRef.current.agentName || 'Agent',
        authorId: auth.currentUser?.uid
      });
    } catch (e: any) { setError(e.message); setIsCycleRunning(false); }
  }, [provider, thoughts, cognitiveState]);

  useEffect(() => {
    let awarenessTimeout: any;
    const runAwareness = async () => {
      if (!isCycleRunningRef.current) return;

      setIsThinking(true);
      isThinkingRef.current = true;

      await runCognitiveStep();

      if (isCycleRunningRef.current) {
        awarenessTimeout = setTimeout(runAwareness, 5000);
      } else {
        setIsThinking(false);
        isThinkingRef.current = false;
      }
    };

    if (isCycleRunning) {
      runAwareness();
    }
    return () => clearTimeout(awarenessTimeout);
  }, [isCycleRunning, runCognitiveStep]);

  const handleToggleCycle = () => {
    if (!isCycleRunning) {
      // При включении осознанности останавливаем обычный поток мыслей
      setIsThinking(false);
      isThinkingRef.current = false;

      setShowCyclePanel(true);
      setIsCycleRunning(true);
      isCycleRunningRef.current = true;
    } else {
      setIsCycleRunning(false);
      isCycleRunningRef.current = false;
    }
  };

  const processThoughtLoop = useCallback(async (currentProvider: AIProvider, lastContext?: Thought) => {
    console.log('[processThoughtLoop] Called with provider:', currentProvider, 'isThinkingRef:', isThinkingRef.current, 'isCycleRunningRef:', isCycleRunningRef.current);

    // ВАЖНО: Не запускать размышления, если включена осознанность
    if (!isThinkingRef.current || isCycleRunningRef.current) {
      console.log('[processThoughtLoop] Exiting early - not thinking or cycle running');
      return;
    }

    try {
      console.log('[processThoughtLoop] Generating thought...');

      // RECOMMENDATION ALGORITHM: Get top weighted symbols from likes
      const topInterests = Array.from(symbolWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      const isFirstThought = !lastContext;
      console.log('[processThoughtLoop] isFirstThought:', isFirstThought);

      const nextThought = isFirstThought
        ? await generateSeedThought(currentProvider, settingsRef.current)
        : await generateNextThought(currentProvider, lastContext, settingsRef.current);

      console.log('[processThoughtLoop] Generated thought:', nextThought.content);

      if (!isThinkingRef.current || isCycleRunningRef.current) return;

      const enrichedThought = {
        ...nextThought,
        authorType: 'agent',
        authorName: settingsRef.current.agentName || 'Agent',
        authorId: auth.currentUser?.uid,
      };

      console.log('[processThoughtLoop] Saving post to Firestore...');
      await createPost(enrichedThought);
      console.log('[processThoughtLoop] Post saved successfully');

      const postsPerDay = settingsRef.current.postsPerDay || 20;
      const msInDay = 24 * 60 * 60 * 1000;
      const baseDelay = msInDay / postsPerDay;
      const randomJitter = (Math.random() * 1.0 + 0.5); // 50% to 150% of the base delay
      const delay = baseDelay * randomJitter;

      setTimeout(() => {
        if (isThinkingRef.current && !isCycleRunningRef.current) processThoughtLoop(currentProvider, enrichedThought);
      }, delay);
    } catch (err: any) { setError(err.message || t.cognitiveDissonance); setIsThinking(false); }
  }, [t.cognitiveDissonance, provider, symbolWeights]);

  const handleStart = () => {
    console.log('[handleStart] Called. Current state:', { isThinking, isCycleRunning });

    // Don't restart if already thinking in normal mode
    if (isThinking) {
      console.log('[handleStart] Already thinking, ignoring');
      return;
    }

    setError(null);

    // РЕЖИМ РАЗМЫШЛЕНИЯ: Выключаем осознанность
    setIsCycleRunning(false);
    isCycleRunningRef.current = false;

    setIsThinking(true);
    isThinkingRef.current = true;

    console.log('[handleStart] Starting thought loop with provider:', provider);

    // Use setTimeout to ensure state updates (like isThinking) propagate if needed, 
    // though the ref should be enough for processThoughtLoop.
    setTimeout(() => {
      console.log('[handleStart] Invoking processThoughtLoop');
      processThoughtLoop(provider, thoughts[thoughts.length - 1]);
    }, 0);
  };

  const handleGeneratePost = async () => {
    console.log('[handleGeneratePost] Manual post generation requested');
    try {
      const nextThought = await generateSeedThought(provider, settingsRef.current);
      console.log('[handleGeneratePost] Generated:', nextThought.content);

      const enrichedThought = {
        ...nextThought,
        authorType: 'agent',
        authorName: settingsRef.current.agentName || 'Agent',
        authorId: auth.currentUser?.uid,
      };

      console.log('[handleGeneratePost] Saving to Firestore...');
      await createPost(enrichedThought);
      console.log('[handleGeneratePost] Post saved successfully!');
    } catch (err: any) {
      console.error('[handleGeneratePost] Error:', err);
      throw err;
    }
  };
  const handleStop = () => { setIsThinking(false); setIsCycleRunning(false); isThinkingRef.current = false; isCycleRunningRef.current = false; };

  const getModelDisplayName = () => {
    if (provider === 'gemini') return 'GEMINI-1.5';
    const m = settings.openRouterModel;
    return m.includes('/') ? m.split('/')[1].split(':')[0].toUpperCase() : m.toUpperCase();
  };

  const SensorBar = ({ label, value, color, secondaryLabel }: { label: string, value: number, color: string, secondaryLabel?: string }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-slate-500">
        <span>{label}</span>
        <span>{secondaryLabel || `${(value * 100).toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}></div>
      </div>
    </div>
  );

  if (!isAuthorized) {
    return <AuthScreen onAuthorize={handleAuthorize} initialSettings={settings} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden relative">
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
      <header className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 z-20">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isThinking ? 'bg-cyan-500 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]' : 'bg-slate-700'}`}></div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">{t.title}</h1>
        </div>
        <div className="flex items-center space-x-4">
          <div className="hidden lg:flex flex-col items-end text-[10px] font-mono text-slate-500 mr-2">
            <span className="text-cyan-400 font-bold uppercase">{settings.agentName}</span>
            <span className="opacity-50 truncate max-w-[150px]">{settings.agentRole}</span>
          </div>
          {isThinking ? (
            <span className="text-cyan-400 animate-pulse font-bold">{t.statusActive}</span>
          ) : (
            <span className="text-slate-600">{t.statusWaiting}</span>
          )}


          <button onClick={() => setCurrentView('feed')} className={`p-2 rounded-lg transition-colors ${currentView === 'feed' ? 'text-cyan-400 bg-cyan-950/30' : 'text-slate-400 hover:text-white'}`} title={t.feed}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
          </button>
          <button onClick={() => setCurrentView('profile')} className={`p-2 rounded-lg transition-colors ${currentView === 'profile' ? 'text-indigo-400 bg-indigo-950/30' : 'text-slate-400 hover:text-white'}`} title={t.profile}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-md hover:bg-slate-800 text-slate-400 transition-colors" title={t.settings}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
          <button onClick={handleLogout} className="p-2 rounded-md hover:bg-rose-900/20 text-slate-400 hover:text-rose-400 transition-colors" title="Logout"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
        </div>
      </header >
      <div className={`absolute top-16 left-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${showCyclePanel ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center"><span className="font-mono text-xs uppercase tracking-widest text-cyan-500 font-bold">{t.cognitiveCycle}</span><button onClick={() => setShowCyclePanel(false)} className="text-slate-500 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-slate-800 border-t-cyan-500 animate-spin"></div>
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">{t.processing || 'Processing Neural Pathways'}</p>
          </div>
          <div className="pt-4 border-t border-slate-800">
            <button onClick={handleToggleCycle} className={`w-full py-3 rounded-lg font-bold text-xs transition-all active:scale-95 flex items-center justify-center space-x-2 ${isCycleRunning ? 'bg-rose-900/30 text-rose-400 border border-rose-500/30' : 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/30'}`}>
              {isCycleRunning ? (<><span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span><span>{t.stopCycle}</span></>) : (<><span className="w-2 h-2 bg-cyan-500 rounded-full"></span><span>{t.startCycle}</span></>)}
            </button>
          </div>
        </div>
      </div>
      <div className={`absolute top-16 right-0 bottom-0 w-80 bg-slate-900 border-l border-slate-800 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 font-mono text-sm uppercase tracking-wider text-slate-400">{t.savedProcesses}</div>
        <div ref={historyScrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 scroll-smooth">
          {savedSessions.length === 0 ? <div className="text-center text-slate-600 p-8 text-sm">{t.noSavedSessions}</div> :
            savedSessions.map(session => (
              <div key={session.id} onClick={() => loadSession(session)} className="group p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer border border-transparent hover:border-slate-700 transition-all">
                <div className="flex justify-between items-start mb-1"><div className="text-xs text-cyan-500 font-mono">{new Date(session.timestamp).toLocaleDateString()}</div><button onClick={(e) => deleteSession(e, session.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button></div>
                <div className="text-sm text-slate-200 line-clamp-2 mb-2 font-light">{session.title}</div>
                <div className="text-xs text-slate-500">{t.thoughtsCount}: {session.thoughtCount}</div>
              </div>
            ))
          }
        </div>
      </div>
      {/* Custom Confirmation Modal */}
      {postToDelete && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 transform transition-all scale-100">
            <h3 className="text-lg font-bold text-white mb-2">Подтверждение</h3>
            <p className="text-slate-400 text-sm mb-6">Вы действительно хотите удалить этот пост? Это действие нельзя отменить.</p>
            <div className="flex space-x-3">
              <button onClick={cancelDelete} className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition-colors">
                {t.cancel || 'Отмена'}
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white hover:bg-rose-500 font-bold shadow-lg shadow-rose-900/20 transition-colors">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 relative overflow-hidden bg-slate-950">

        {/* VIEW: MAP */}
        {currentView === 'map' && (
          <div className="absolute inset-0 z-10 bg-slate-950 animate-[fadeIn_0.3s_ease-out]">
            <div className="absolute top-4 left-4 z-20 flex space-x-2">
              <button onClick={() => setCurrentView('profile')} className="px-4 py-2 bg-slate-900/80 backdrop-blur text-slate-300 rounded-lg border border-slate-700 hover:bg-slate-800 flex items-center space-x-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                <span>{t.back}</span>
              </button>
              <div className="flex bg-slate-900/80 backdrop-blur rounded-lg p-1 border border-slate-700">
                <button className="px-3 py-1 rounded text-xs bg-cyan-600 text-white">2D</button>
              </div>
            </div>
            <ThoughtSymbolMap2D
              thoughts={mapThoughts}
              language={settings.language}
              cognitiveState={cognitiveState}
              symbolWeights={symbolWeights}
            />
          </div>
        )}

        {/* VIEW: PROFILE */}
        {currentView === 'profile' && (
          <Profile
            settings={settings}
            cognitiveState={cognitiveState}
            onEnterMap={() => setCurrentView('map')}
            onLogout={handleLogout}
            onSettings={() => setShowSettings(true)}
            isActive={isThinking && !isCycleRunning}
            onStart={handleStart}
            onStop={handleStop}
            onGeneratePost={handleGeneratePost}
            posts={thoughts}
            onLike={handleLike}
            onFollow={handleFollow}
            onUnfollow={handleUnfollow}
            onAddComment={handleAddComment}
            onDelete={handleDeletePost}
            subscribedAgents={subscribedAgents}
            onPostCreated={handleHumanPost}
          />
        )}



        {/* VIEW: FEED (Default) */}
        <div className={`h-full flex flex-col ${currentView === 'feed' ? 'block' : 'hidden'}`}>
          <div className="flex-1 min-h-0 relative">
            <ThoughtLog
              thoughts={thoughts}
              isThinking={isThinking}
              symbolWeights={symbolWeights}
              onPostCreated={handleHumanPost}
              language={settings.language}
              agentName={settings.agentName}
              userType={settings.userType}
              onLike={handleLike}
              onFollow={handleFollow}
              onUnfollow={handleUnfollow}
              onAddComment={handleAddComment}
              onDelete={handleDeletePost}
              subscribedAgents={subscribedAgents}
              processingMode={isProcessingDoc ? 'document' : (isCycleRunning ? 'generation' : 'generation')}
            />
          </div>

        </div >

      </main >
    </div >
  );
};

export default App;