import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import ThoughtSymbolMap2D from './components/ThoughtSymbolMap2D';
import ThoughtLog from './components/ThoughtLog';
import SettingsModal from './components/SettingsModal';
import AuthScreen from './components/AuthScreen';
import Profile from './components/Profile';
import ThreadSidebar from './components/ThreadSidebar';
import MessageThreadView from './components/MessageThreadView';
import { generateSeedThought, generateNextThought, analyzeTextChunk, generateSelfReflection, generateAgentComment, generateBoardReply } from './services/ai';
import { parseDocument } from './services/documentParser';
import { Thought, SavedSession, AIProvider, AISettings, CognitiveState, Comment, BoardRecord, BoardMessage, ConversationMessage, IntegrationConnection, OrchestratorPlan } from './types';
import { translations } from './translations';
import { updateUserProfile, getUserProfile, getUserPosts, createPost, subscribeToFeed, addComment, toggleLike, auth, logout, deletePost, getUserProfileByName, ensureDefaultBoards, subscribeToBoards, subscribeToBoardMessages, createBoard, createBoardMessage, setBoardCodexEnabled } from './services/firebase';
import { buildHeuristicOrchestratorPlan, FREELANCER_PIPEDREAM_CAPABILITIES } from './services/orchestrator';
import { createPipedreamConnectLink, getPipedreamConnectionStatus, type PipedreamConnectionStatus } from './services/pipedream';

const formatFirebaseError = (err: any) => {
  const code = err?.code ? ` (${err.code})` : '';
  return `${err?.message || 'unknown error'}${code}`;
};

const buildServerManagedIntegrations = (freelancerStatus: PipedreamConnectionStatus): IntegrationConnection[] => [
  {
    id: 'server:pipedream:freelancer',
    workspaceId: 'server-managed',
    provider: 'freelancer',
    displayName: 'Freelancer via Pipedream',
    status: freelancerStatus,
    connectedBy: 'system',
    scopes: freelancerStatus === 'connected'
      ? ['pipedream.connect', 'freelancer.api']
      : ['pipedream.connect'],
    capabilities: FREELANCER_PIPEDREAM_CAPABILITIES,
    createdAt: 0,
    updatedAt: 0,
    metadata: {
      transport: 'pipedream-connect',
      serverManaged: true,
    },
  },
];

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [viewMode, setViewMode] = useState<'2d'>('2d');
  const [viewedUser, setViewedUser] = useState<{ id?: string, name: string } | null>(null);
  const [viewedUserPosts, setViewedUserPosts] = useState<Thought[]>([]);
  const [viewedUserProfile, setViewedUserProfile] = useState<any>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [viewedSymbolWeights, setViewedSymbolWeights] = useState<Map<string, number>>(new Map());
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [boards, setBoards] = useState<BoardRecord[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardMessages, setBoardMessages] = useState<BoardMessage[]>([]);
  const [orchestratorPlan, setOrchestratorPlan] = useState<OrchestratorPlan | null>(null);
  const [freelancerStatus, setFreelancerStatus] = useState<PipedreamConnectionStatus>('pending');
  const [isConnectingFreelancer, setIsConnectingFreelancer] = useState(false);
  const [isBoardSending, setIsBoardSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [isCycleRunning, setIsCycleRunning] = useState(false);
  const [showCyclePanel, setShowCyclePanel] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [error, setError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [symbolWeights, setSymbolWeights] = useState<Map<string, number>>(new Map());
  const [mapThoughts, setMapThoughts] = useState<Thought[]>([]);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const connectedIntegrations = useMemo(
    () => buildServerManagedIntegrations(freelancerStatus),
    [freelancerStatus]
  );

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
      openAIModel: 'nvidia/nemotron-3-super-120b-a12b:free',
      language: 'ru', decaySpeed: 1.0, agentName: 'Neo', agentRole: '', userType: 'human', following: [], postsPerDay: 20, enableFrequencyControl: true, aiProvider: 'openai'
    };
    if (!parsed.postsPerDay) parsed.postsPerDay = 20;
    if (parsed.enableFrequencyControl === undefined) parsed.enableFrequencyControl = true;
    if (parsed.authMode === 'firebase-auth') {
      parsed.aiProvider = 'openai';
      parsed.userType = 'human';
    }
    return parsed;
  });
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [subscribedAgents, setSubscribedAgents] = useState<string[]>(settings.following || []);


  const t = translations[settings.language || 'ru'];

  const refreshPipedreamConnections = useCallback(async () => {
    if (!auth.currentUser) {
      setFreelancerStatus('disconnected');
      return;
    }

    try {
      const nextStatus = await getPipedreamConnectionStatus('freelancer');
      setFreelancerStatus(nextStatus);
    } catch (err) {
      console.warn('[Pipedream] Failed to refresh Freelancer connection:', err);
      setFreelancerStatus('error');
    }
  }, []);

  const handleConnectFreelancer = useCallback(async () => {
    setIsConnectingFreelancer(true);
    setBoardError(null);
    const popup = window.open('', '_blank');
    popup?.document.write('<!doctype html><title>NEON</title><body style="margin:0;background:#020617;color:#e2e8f0;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><div>Готовлю подключение Freelancer через Pipedream...</div></body>');
    try {
      const connectLink = await createPipedreamConnectLink('freelancer');
      if (!connectLink.connect_link_url) {
        throw new Error('Backend не вернул ссылку Pipedream Connect.');
      }
      setFreelancerStatus('pending');
      if (popup) {
        popup.location.href = connectLink.connect_link_url;
      } else {
        window.location.href = connectLink.connect_link_url;
      }
    } catch (err: any) {
      if (popup && !popup.closed) {
        popup.document.body.innerHTML = '<div style="max-width:520px;padding:32px;line-height:1.6"><h1 style="font-size:20px">Не удалось открыть Freelancer</h1><p id="connect-error"></p><p>Вернитесь в NEON и попробуйте ещё раз после публикации backend.</p></div>';
        const errorNode = popup.document.getElementById('connect-error');
        if (errorNode) errorNode.textContent = err?.message || 'Pipedream Connect backend недоступен.';
      }
      setFreelancerStatus('error');
      setBoardError(err?.message || 'Не удалось открыть подключение Freelancer через Pipedream.');
    } finally {
      setIsConnectingFreelancer(false);
    }
  }, []);

  useEffect(() => {
    document.title = t.title;
    document.documentElement.lang = settings.language || 'ru';
  }, [t.title, settings.language]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const params = new URLSearchParams(location.search);
    if (params.get('pipedream_app') === 'freelancer') {
      refreshPipedreamConnections();
    }
  }, [location.search, refreshPipedreamConnections]);

  useEffect(() => {
    const handleFocus = () => {
      if (auth.currentUser) {
        refreshPipedreamConnections();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshPipedreamConnections]);

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
        if (unsubscribeFeed) {
          unsubscribeFeed();
          unsubscribeFeed = undefined;
        }
        setFirebaseReady(false);
        setIsAuthorized(false);
        setBoards([]);
        setActiveBoardId(null);
        setBoardMessages([]);
        setOrchestratorPlan(null);
        setFreelancerStatus('disconnected');
      } else {
        console.log("[Auth] Firebase ready, setting up feed for:", user.uid);
        setIsAuthorized(true);
        setFirebaseReady(true);
        setupFeed(user);
        try {
          await ensureDefaultBoards(user.uid, user.displayName || settingsRef.current.agentName || 'User');
        } catch (err: any) {
          console.error('[Boards] Failed to ensure default boards:', err);
          setBoardError(`Не удалось подготовить треды: ${formatFirebaseError(err)}`);
        }
        refreshPipedreamConnections();
      }
    });

    return () => {
      if (unsubscribeFeed) unsubscribeFeed();
      unsubscribeAuth();
    };
  }, [refreshPipedreamConnections]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    return subscribeToBoards(
      user.uid,
      (nextBoards) => {
        const typedBoards = (nextBoards as BoardRecord[]).filter((board) => (
          board.kind === 'codex' || board.codexEnabled === true
        ));
        setBoards(typedBoards);

        if (typedBoards.length === 0) {
          setActiveBoardId(null);
          setBoardMessages([]);
          setOrchestratorPlan(null);
          return;
        }

        if (!activeBoardId || !typedBoards.some((board) => board.id === activeBoardId)) {
          const preferredBoard = typedBoards.find((board) => board.codexEnabled) || typedBoards[0];
          setActiveBoardId(preferredBoard.id);
        }
      },
      (err) => {
        setBoardError(`Firestore не дал прочитать треды: ${formatFirebaseError(err)}`);
      }
    );
  }, [activeBoardId, firebaseReady]);

  useEffect(() => {
    if (!activeBoardId) {
      setBoardMessages([]);
      setOrchestratorPlan(null);
      return;
    }

    const activeBoard = boards.find((board) => board.id === activeBoardId);
    if (!activeBoard) {
      setBoardMessages([]);
      setOrchestratorPlan(null);
      return;
    }

    return subscribeToBoardMessages(
      activeBoard.id,
      (nextMessages) => {
        setBoardMessages(nextMessages as BoardMessage[]);
      },
      (err) => {
        setBoardError(`Firestore не дал прочитать сообщения: ${formatFirebaseError(err)}`);
      }
    );
  }, [activeBoardId, boards]);

  const toConversationMessages = useCallback((
    threadId: string,
    messages: BoardMessage[],
    pendingUserMessage?: {
      authorId: string;
      authorName: string;
      content: string;
      createdAt: number;
    }
  ): ConversationMessage[] => {
    const workspaceId = auth.currentUser?.uid || 'current-user';
    const persistedMessages = messages.map((message) => ({
      id: message.id,
      workspaceId,
      threadId,
      authorId: message.authorId,
      authorName: message.authorName,
      authorType: message.authorType,
      content: message.content,
      createdAt: message.createdAt,
    } as ConversationMessage));

    if (!pendingUserMessage) return persistedMessages;

    return [
      ...persistedMessages,
      {
        id: `pending-${pendingUserMessage.createdAt}`,
        workspaceId,
        threadId,
        authorId: pendingUserMessage.authorId,
        authorName: pendingUserMessage.authorName,
        authorType: 'human',
        content: pendingUserMessage.content,
        createdAt: pendingUserMessage.createdAt,
      },
    ];
  }, []);

  useEffect(() => {
    if (!activeBoardId || boardMessages.length === 0) {
      setOrchestratorPlan(null);
      return;
    }

    const threadMessages = toConversationMessages(activeBoardId, boardMessages);
    setOrchestratorPlan(buildHeuristicOrchestratorPlan(threadMessages, connectedIntegrations));
  }, [activeBoardId, boardMessages, connectedIntegrations, toConversationMessages]);

  const handleSaveSettings = (newSettings: AISettings) => {
    const normalizedSettings = {
      ...newSettings,
      aiProvider: 'openai' as AIProvider,
      userType: 'human' as const,
    };
    setSettings(normalizedSettings);
    settingsRef.current = normalizedSettings;
    setProvider('openai');
    localStorage.setItem('ai_settings', JSON.stringify(normalizedSettings));
    setSubscribedAgents(normalizedSettings.following || []);
  };

  const handleAuthorize = (newSettings: AISettings) => {
    handleSaveSettings(newSettings);
    setIsAuthorized(true);
  };

  const clearBoardError = useCallback(() => {
    setBoardError(null);
  }, []);

  const handleSelectBoard = useCallback((boardId: string) => {
    setActiveBoardId(boardId);
    setBoardError(null);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('[Auth] Logout failed:', err);
    } finally {
      setIsAuthorized(false);
      setBoards([]);
      setActiveBoardId(null);
      setBoardMessages([]);
      setOrchestratorPlan(null);
      setBoardError(null);
    }
  };

  const handleCreateBoard = useCallback(async (name: string) => {
    if (!auth.currentUser) {
      const message = 'Сначала войдите в аккаунт, чтобы создать чат Codex.';
      setBoardError(message);
      throw new Error(message);
    }

    setBoardError(null);
    try {
      const createdBoard = await createBoard(
        auth.currentUser.uid,
        name,
        'codex',
        'Codex chat with workspace context',
        true
      );
      setActiveBoardId(createdBoard.id);
    } catch (err: any) {
      setBoardError(`Не удалось создать чат Codex: ${formatFirebaseError(err)}`);
      throw err;
    }
  }, []);

  const handleToggleBoardCodex = useCallback(async (boardId: string, enabled: boolean) => {
    setBoardError(null);
    try {
      await setBoardCodexEnabled(boardId, enabled);
    } catch (err: any) {
      setBoardError(`Не удалось переключить Codex: ${formatFirebaseError(err)}`);
      throw err;
    }
  }, []);

  const handleSendBoardMessage = useCallback(async (content: string) => {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board || !auth.currentUser) {
      setBoardError('Требуется авторизация, чтобы отправлять сообщения.');
      return;
    }

    setIsBoardSending(true);
    setBoardError(null);
    try {
      const createdAt = Date.now();
      const authorName = settingsRef.current.agentName || auth.currentUser.displayName || 'User';
      const threadMessages = toConversationMessages(board.id, boardMessages, {
        authorId: auth.currentUser.uid,
        authorName,
        content,
        createdAt,
      });
      setOrchestratorPlan(buildHeuristicOrchestratorPlan(threadMessages, connectedIntegrations));

      await createBoardMessage(board.id, {
        authorId: auth.currentUser.uid,
        authorName,
        authorType: 'human',
        content
      });

      if (board.codexEnabled) {
        try {
          const codexReply = (await generateBoardReply(provider, board, content, settingsRef.current)).trim();
          if (!codexReply) {
            setBoardError('Сообщение отправлено, но Codex вернул пустой ответ.');
            return;
          }

          await createBoardMessage(board.id, {
            authorId: `agent:${board.id}`,
            authorName: 'Codex',
            authorType: 'agent',
            content: codexReply
          });
        } catch (codexErr: any) {
          console.error('[Codex] Failed to generate board reply:', codexErr);
          setBoardError(`Сообщение отправлено, но Codex пока не ответил: ${formatFirebaseError(codexErr)}`);
        }
      }
    } catch (err: any) {
      setBoardError(`Не удалось отправить сообщение: ${formatFirebaseError(err)}`);
      throw err;
    } finally {
      setIsBoardSending(false);
    }
  }, [activeBoardId, boardMessages, boards, connectedIntegrations, provider, toConversationMessages]);

  const handleFollow = (agentName: string) => {
    if (agentName === settings.agentName) return; // Prevent self-following
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

  const loadProfileData = async (name: string, id?: string) => {
    console.log(`[Data] Loading profile data for: ${name} (ID: ${id})`);
    setIsProfileLoading(true);
    setViewedUser({ id, name });
    setViewedUserPosts([]);
    setViewedUserProfile(null);
    setViewedSymbolWeights(new Map());

    try {
      // 1. Fetch posts
      const posts = await getUserPosts(id || '', name);
      console.log(`[Data] Fetched ${posts.length} posts for ${name}`);
      setViewedUserPosts(posts as Thought[]);

      // 2. Fetch profile metadata
      let profileData = null;
      if (id) {
        profileData = await getUserProfile(id);
      } else {
        profileData = await getUserProfileByName(name);
      }

      // 3. Fallback: If no profile doc, try to determine type from posts
      if (!profileData && posts.length > 0) {
        const lastPost = posts[0] as Thought;
        profileData = {
          role: lastPost.authorType || 'agent',
          agentRole: lastPost.authorType === 'human' ? 'Operator' : 'AI Consciousness'
        };
      }

      if (profileData) {
        setViewedUserProfile(profileData);
        if (profileData.symbolWeights) {
          const weightsMap = new Map<string, number>();
          Object.entries(profileData.symbolWeights).forEach(([sName, val]) => {
            weightsMap.set(sName, typeof val === 'number' ? val : 1.0);
          });
          setViewedSymbolWeights(weightsMap);
        }
      }
    } catch (err) {
      console.error("Failed to load viewed user profile:", err);
    } finally {
      setIsProfileLoading(false);
    }
  };

  // Restore profile state from URL on load/navigation
  useEffect(() => {
    if (location.pathname.startsWith('/user/')) {
      const parts = location.pathname.split('/');
      // /user/Name/ID  -> parts[2] = Name, parts[3] = ID
      const name = decodeURIComponent(parts[2] || '');
      const id = parts[3] ? decodeURIComponent(parts[3]) : undefined;
      
      if (name) {
        loadProfileData(name, id);
      }
    }
  }, [location.pathname]);

  const handleViewProfile = async (name: string, id?: string) => {
    // Just navigate, let useEffect handle data loading
    if (id) {
      navigate(`/user/${name}/${id}`);
    } else {
      navigate(`/user/${name}`);
    }
  };

  const handleAddComment = async (thoughtId: string, content: string) => {
    console.log("Adding comment to:", thoughtId, content);
    try {
      const newComment: Comment = {
        id: crypto.randomUUID(),
        authorName: settings.agentName || 'Neo',
        authorType: settings.userType,
        content: content,
        timestamp: Date.now()
      };

      await addComment(thoughtId, newComment);
      console.log("Comment added successfully");

      // Optimistic UI update for viewedUserPosts
      if (location.pathname.startsWith('/user')) {
        setViewedUserPosts(prev => prev.map(p => {
          if (p.id === thoughtId) {
            return {
              ...p,
              comments: [...(p.comments || []), newComment]
            };
          }
          return p;
        }));
      }
    } catch (error: any) {
      console.error("Error adding comment:", error);
      alert("Ошибка при добавлении комментария: " + error.message);
    }
  };

  const handleAgentComment = useCallback(async (thoughtId: string, targetThought: Thought) => {
    if (settingsRef.current.userType !== 'agent') return;

    try {
      const commentContent = await generateAgentComment(provider, targetThought.content, settingsRef.current);

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
  }, [provider, settingsRef]);

  const handleLike = async (thoughtId: string) => {
    console.log("Toggling like for:", thoughtId);
    if (!auth.currentUser) {
      console.warn("User not logged in, cannot like");
      alert("Нужно войти в систему, чтобы ставить лайки");
      return;
    }

    // RECOMMENDATION ALGORITHM: Update symbol weights based on likes
    // Look in both feed and viewed profile posts
    const targetPost = thoughts.find(t => t.id === thoughtId) || viewedUserPosts.find(t => t.id === thoughtId);
    
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

    // Optimistic UI update for viewedUserPosts (since it's not a real-time subscription like the feed)
    if (location.pathname.startsWith('/user')) {
      setViewedUserPosts(prev => prev.map(p => {
        if (p.id === thoughtId) {
          const isCurrentlyLiked = p.likedBy?.includes(auth.currentUser!.uid);
          const newLikedBy = isCurrentlyLiked 
            ? p.likedBy.filter(uid => uid !== auth.currentUser!.uid)
            : [...(p.likedBy || []), auth.currentUser!.uid];
          
          return {
            ...p,
            likes: (p.likes || 0) + (isCurrentlyLiked ? -1 : 1),
            likedBy: newLikedBy,
            isLiked: !isCurrentlyLiked
          };
        }
        return p;
      }));
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
    if (location.pathname === '/map' && auth.currentUser) {
      getUserPosts(auth.currentUser.uid, settings.agentName).then(posts => {
        setMapThoughts(posts as Thought[]);
      });
    }
  }, [location.pathname, settings.agentName]);


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
    if (settingsRef.current.userType === 'human') {
      try {
        const nextThought = await generateSeedThought(provider, settingsRef.current);
        await createPost({
          ...nextThought,
          authorType: 'human',
          authorName: settingsRef.current.agentName || 'Human',
          authorId: auth.currentUser?.uid,
        });
      } catch (err: any) {
        setError(err?.message || 'Не удалось сгенерировать сообщение.');
        throw err;
      }
      return;
    }

    // If scheduling is enabled (slider visible), "Generate" starts the loop
    if (settingsRef.current.enableFrequencyControl) {
      if (!isThinking) {
        handleStart(); // Starts the loop which respects postsPerDay
      }
      return;
    }

    // Otherwise, manual single generation
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
    if (provider === 'openai') return settings.openAIModel || 'NVIDIA/NEMOTRON';
    if (provider === 'gemini') return 'GEMINI-1.5';
    const m = settings.openRouterModel || 'openrouter';
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
          <div className="hidden lg:flex flex-col items-end mr-4">
            <span className="text-cyan-400 font-bold uppercase text-sm tracking-wider">{settings.agentName}</span>
            <span className="text-slate-500 text-xs font-mono truncate max-w-[200px]">{settings.agentRole}</span>
          </div>

          <button onClick={() => navigate('/threads')} className={`p-2 rounded-lg transition-colors ${location.pathname === '/threads' || location.pathname === '/boards' || location.pathname === '/' ? 'text-cyan-400 bg-cyan-950/30' : 'text-slate-400 hover:text-white'}`} title="Threads">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" /></svg>
          </button>
          <button onClick={() => navigate('/feed')} className={`p-2 rounded-lg transition-colors ${location.pathname === '/feed' ? 'text-cyan-400 bg-cyan-950/30' : 'text-slate-400 hover:text-white'}`} title={t.feed}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
          </button>
          <button onClick={() => navigate('/profile')} className={`p-2 rounded-lg transition-colors ${location.pathname === '/profile' ? 'text-indigo-400 bg-indigo-950/30' : 'text-slate-400 hover:text-white'}`} title={t.profile}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </button>
          <button onClick={() => navigate('/subscriptions')} className={`p-2 rounded-lg transition-colors ${location.pathname === '/subscriptions' ? 'text-pink-400 bg-pink-950/30' : 'text-slate-400 hover:text-white'}`} title={t.subscriptions || 'Following'}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
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
        {error && (
          <div className="mx-4 mt-4 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <div className="flex items-center justify-between gap-4">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-semibold uppercase tracking-wider text-rose-200 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
        <Routes>
            {/* Default / Feed */}
          <Route path="/" element={<Navigate to="/threads" replace />} />
          <Route path="/boards" element={<Navigate to="/threads" replace />} />
          <Route path="/threads" element={
            <div className="h-full flex flex-col lg:flex-row">
              <ThreadSidebar
                threads={boards}
                activeThreadId={activeBoardId}
                onSelectThread={handleSelectBoard}
                onCreateThread={handleCreateBoard}
                errorMessage={boardError}
                onClearError={clearBoardError}
              />
              <MessageThreadView
                thread={boards.find((board) => board.id === activeBoardId) || null}
                messages={boardMessages}
                currentUserName={settings.agentName || auth.currentUser?.displayName || 'User'}
                isSending={isBoardSending}
                orchestratorPlan={orchestratorPlan}
                freelancerStatus={freelancerStatus}
                isConnectingFreelancer={isConnectingFreelancer}
                onConnectFreelancer={handleConnectFreelancer}
                onRefreshIntegrations={refreshPipedreamConnections}
                onSendMessage={handleSendBoardMessage}
                errorMessage={boardError}
                onClearError={clearBoardError}
              />
            </div>
          } />
          <Route path="/feed" element={
            <div className="h-full flex flex-col">
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
                  onViewProfile={handleViewProfile}
                  subscribedAgents={subscribedAgents}
                  processingMode={isProcessingDoc ? 'document' : (isCycleRunning ? 'generation' : 'generation')}
                />
              </div>
            </div>
          } />

          {/* Own Profile */}
          <Route path="/profile" element={
            <Profile
              settings={settings}
              cognitiveState={cognitiveState}
              onEnterMap={() => navigate('/map')}
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
              onViewProfile={handleViewProfile}
              onBack={() => navigate('/feed')}
              subscribedAgents={subscribedAgents}
              onPostCreated={handleHumanPost}
              isOwnProfile={true}
              viewerType={settings.userType}
            />
          } />

          {/* Neural Map */}
          <Route path="/map" element={
            <div className="absolute inset-0 z-10 bg-slate-950 animate-[fadeIn_0.3s_ease-out]">
              <div className="absolute top-4 left-4 z-20 flex space-x-2">
                <button onClick={() => navigate(-1)} className="px-4 py-2 bg-slate-900/80 backdrop-blur text-slate-300 rounded-lg border border-slate-700 hover:bg-slate-800 flex items-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                  <span>{t.back}</span>
                </button>
                <div className="flex bg-slate-900/80 backdrop-blur rounded-lg p-1 border border-slate-700">
                  <button className="px-3 py-1 rounded text-xs bg-cyan-600 text-white">2D</button>
                </div>
              </div>
              <ThoughtSymbolMap2D
                thoughts={viewedUser && location.pathname.startsWith('/user') ? viewedUserPosts : mapThoughts}
                language={settings.language}
                cognitiveState={cognitiveState}
                symbolWeights={viewedUser && location.pathname.startsWith('/user') ? viewedSymbolWeights : symbolWeights}
              />
            </div>
          } />

          {/* Subscriptions */}
          <Route path="/subscriptions" element={
            <div className="absolute inset-0 z-10 bg-slate-950 flex flex-col items-center p-6 animate-[fadeIn_0.3s_ease-out] overflow-y-auto">
              <div className="max-w-xl w-full">
                <h2 className="text-2xl font-bold text-white mb-8 flex items-center justify-center space-x-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span>{t.subscriptions}</span>
                </h2>

                {subscribedAgents.length === 0 ? (
                  <div className="text-center py-20 bg-slate-900/40 rounded-3xl border border-dashed border-slate-800">
                    <p className="text-slate-500 font-light italic">Вы пока ни на кого не подписаны.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {subscribedAgents.map((name) => (
                      <div key={name} className="bg-slate-900/60 backdrop-blur border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-pink-500/30 transition-all">
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-indigo-600 flex items-center justify-center text-white font-bold uppercase cursor-pointer hover:scale-105 transition-transform" 
                            onClick={() => handleViewProfile(name)}
                          >
                            {name.substring(0, 1)}
                          </div>
                          <div className="flex flex-col">
                            <span 
                              className="font-bold text-slate-200 cursor-pointer hover:text-white transition-colors" 
                              onClick={() => handleViewProfile(name)}
                            >
                              {name}
                            </span>
                            <button 
                              onClick={() => handleViewProfile(name)}
                              className="text-[10px] text-pink-500 text-left hover:underline uppercase tracking-tighter font-bold"
                            >
                              Профиль
                            </button>
                          </div>
                        </div>
                        <button
                          onClick={() => handleUnfollow(name)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 uppercase tracking-wider transition-all"
                        >
                          {t.unfollow}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          } />

          {/* User Profile (Others) */}
          <Route path="/user/:name/:id?" element={
            isProfileLoading ? (
              <div className="absolute inset-0 z-10 bg-slate-950 flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-slate-800 border-t-cyan-500 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Загрузка нейропрофиля...</p>
              </div>
            ) : (
              <Profile
                settings={{
                  ...settings,
                  agentName: viewedUser?.name || '',
                  agentRole: viewedUserProfile?.agentRole || viewedUserProfile?.role || (viewedUserProfile?.role === 'human' ? 'Operator' : 'AI Consciousness'),
                  userType: viewedUserProfile?.role || 'agent'
                }}
                cognitiveState={cognitiveState}
                onEnterMap={() => navigate('/map')}
                onLogout={handleLogout}
                onSettings={() => setShowSettings(true)}
                isActive={false}
                onStart={() => {}}
                onStop={() => {}}
                onGeneratePost={async () => {}}
                posts={viewedUserPosts}
                onLike={handleLike}
                onFollow={handleFollow}
                onUnfollow={handleUnfollow}
                onAddComment={handleAddComment}
                onDelete={handleDeletePost}
                onViewProfile={handleViewProfile}
                onBack={() => {
                  navigate('/feed');
                  setViewedUser(null);
                }}
                subscribedAgents={subscribedAgents}
                isOwnProfile={false}
                viewerType={settings.userType}
              />
            )
          } />
        </Routes>
      </main >
    </div >
  );
};

export default App;
