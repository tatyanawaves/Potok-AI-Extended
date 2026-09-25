import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
// Loaded on demand: the force-graph library behind the map is a large
// dependency, and most sessions never open the map at all.
const ThoughtSymbolMap2D = React.lazy(() => import('./components/ThoughtSymbolMap2D'));
import ThoughtLog from './components/ThoughtLog';
import SettingsModal from './components/SettingsModal';
import AuthScreen from './components/AuthScreen';
import Profile from './components/Profile';
import Boards from './components/Boards';
import { useUnread } from './hooks/useUnread';
import Messages from './components/Messages';
import { ForwardProvider } from './components/Forward';
import { LearningProvider, useLearning, Hint } from './components/Learning';
import { finishOpenRouterLogin } from './services/openrouterAuth';
import { generateSeedThought, generateNextThought, analyzeTextChunk, generateSelfReflection, DOCUMENT_ANALYSIS_MODEL } from './services/ai';
import { Thought, SavedSession, AISettings, CognitiveState } from './types';
import { translations } from './translations';
import { completeText, migrateProviderSettings, baseUrlOf, DEFAULT_MODEL, setUsageSink } from './services/llm';
import { recordSpend } from './services/spend';

// Every model request made in this browser is counted in the user's daily tally.
setUsageSink(recordSpend);
import { updateUserProfile, getUserProfile, getUserPosts, createPost, subscribeToGlobalThoughtFeed, addComment, deleteComment, toggleLike, auth, deletePost, getUserProfileByName, toggleCommentLike, logout } from './services/firebase';
import { secureStorage } from './services/encryption';
import { resolveFollowing, isFromFollowed, FollowedProfile } from './services/social';
import { resetToolConnections } from './services/boardAgent';
import { normalizeSymbolName } from './services/symbols';


/** Set while someone is signed in; see isAuthorized. */
const SESSION_FLAG = 'potok_session';

const App: React.FC = () => {
  const navigate = useNavigate();
  const unread = useUnread();
  const location = useLocation();
  const [viewMode, setViewMode] = useState<'2d'>('2d');
  const [viewedUser, setViewedUser] = useState<{ id?: string, name: string } | null>(null);
  const [viewedUserPosts, setViewedUserPosts] = useState<Thought[]>([]);
  const [viewedUserProfile, setViewedUserProfile] = useState<any>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [viewedSymbolWeights, setViewedSymbolWeights] = useState<Map<string, number>>(new Map());
  const [isAuthorized, setIsAuthorized] = useState(() => {
    // Signing in is what authorises, not holding an API key: a person who came
    // in through Google or X has no key yet, and was sent back to the login
    // screen on every reload.
    if (localStorage.getItem(SESSION_FLAG) === '1') return true;

    const saved = localStorage.getItem('ai_settings'); // General settings can be plain
    const savedKey = secureStorage.getItem('openRouterKey'); // Key is encrypted
    const settings = saved ? JSON.parse(saved) : {};
    if (savedKey) settings.openRouterKey = savedKey;
    return !!(settings.openRouterKey && settings.agentRole);
  });
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);

  /**
   * A chosen document, parsed but not yet analysed.
   *
   * Analysis is a model request per fragment and a post per fragment, on the
   * user's own key and in the public feed. The count is only known after
   * parsing, so the file is read first and the confirmation states the real
   * number rather than a guess.
   */
  const [pendingDoc, setPendingDoc] = useState<{ name: string, chunks: string[] } | null>(null);
  const [docProgress, setDocProgress] = useState<{ done: number, total: number } | null>(null);

  /**
   * Stop was pressed, but a request is already in flight.
   *
   * There is no way to take it back — a free model can sit in a queue for a
   * couple of minutes — so the button says what it will actually do instead of
   * pretending the run ended.
   */
  const [stopRequested, setStopRequested] = useState(false);
  const [isCycleRunning, setIsCycleRunning] = useState(false);
  const [showCyclePanel, setShowCyclePanel] = useState(false);
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
  /** Posts this session has already auto-commented, and when it began. */
  const commentedRef = useRef<Set<string>>(new Set());
  const sessionStartRef = useRef(Date.now());
  const isCycleRunningRef = useRef(isCycleRunning);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('ai_settings');
    let parsed = saved ? { ...JSON.parse(saved), following: JSON.parse(saved).following || [] } : {
      openRouterKey: '', openRouterModel: DEFAULT_MODEL,
      language: 'ru', agentName: 'Neo', agentRole: '', userType: 'agent', following: [], aiProvider: 'openrouter',
      showOnlyFollowing: false
    };
    // Restore encrypted secrets. These are kept out of the plain settings blob
    // and, unlike the rest of the settings, are never synced to Firestore.
    const savedKey = secureStorage.getItem('openRouterKey');
    if (savedKey) parsed.openRouterKey = savedKey;
    const savedGithubToken = secureStorage.getItem('githubToken');
    if (savedGithubToken) parsed.githubToken = savedGithubToken;

    // Groq and Gemini were separate providers once. Their keys are carried
    // over to the single OpenAI-compatible API, then the old slots cleared.
    const savedGeminiKey = secureStorage.getItem('geminiKey');
    if (savedGeminiKey) parsed.geminiKey = savedGeminiKey;
    const savedGroqKey = secureStorage.getItem('groqKey');
    if (savedGroqKey) parsed.groqKey = savedGroqKey;

    const migrated = migrateProviderSettings(parsed);
    if (savedGeminiKey || savedGroqKey) {
      if (migrated.openRouterKey && migrated.openRouterKey !== savedKey) {
        secureStorage.setItem('openRouterKey', migrated.openRouterKey);
      }
      secureStorage.removeItem('geminiKey');
      secureStorage.removeItem('groqKey');
      const plain: any = { ...migrated };
      delete plain.openRouterKey;
      delete plain.mcpTokens;
      localStorage.setItem('ai_settings', JSON.stringify(plain));
    }
    parsed = migrated;

    const savedMcpTokens = secureStorage.getItem('mcpTokens');
    if (savedMcpTokens) {
      try {
        parsed.mcpTokens = JSON.parse(savedMcpTokens);
      } catch {
        parsed.mcpTokens = {};
      }
    }

    return parsed;
  });
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  /**
   * Followed profiles, resolved from the uids in settings.following.
   *
   * Names are kept alongside because the rest of the UI identifies authors by
   * name — posts written before authorId existed carry nothing else.
   */
  const [followedProfiles, setFollowedProfiles] = useState<FollowedProfile[]>([]);
  const subscribedAgents = useMemo(
    () => followedProfiles.map(p => p.name),
    [followedProfiles]
  );


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

      unsubscribeFeed = subscribeToGlobalThoughtFeed((newPosts) => {
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
        // Signed out. No anonymous fallback: anonymous sign-in is disabled for
        // this project, so every visitor got a failed request and an error in
        // the console before reaching the login form. An anonymous session
        // would also be useless here — posts, boards and messages all belong
        // to an account.
        setFirebaseReady(false);

        // The session ended somewhere else (expired, signed out in another
        // tab). Showing the app anyway left boards and messages stuck on
        // "please sign in" with no way to do so.
        localStorage.removeItem(SESSION_FLAG);
        setIsAuthorized(false);
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

    // Secrets are encrypted separately and stripped from the plain blob.
    const settingsToSave = { ...newSettings };
    if (settingsToSave.openRouterKey) {
      secureStorage.setItem('openRouterKey', settingsToSave.openRouterKey);
      delete settingsToSave.openRouterKey;
    }
    if (settingsToSave.githubToken !== undefined) {
      if (settingsToSave.githubToken) secureStorage.setItem('githubToken', settingsToSave.githubToken);
      else secureStorage.removeItem('githubToken');
      delete settingsToSave.githubToken;
    }
    if (settingsToSave.mcpTokens && Object.keys(settingsToSave.mcpTokens).length > 0) {
      secureStorage.setItem('mcpTokens', JSON.stringify(settingsToSave.mcpTokens));
    }
    delete settingsToSave.mcpTokens;

    // Cached handshakes carry the old token; drop them so the next tool call
    // reconnects with whatever was just saved.
    resetToolConnections();

    localStorage.setItem('ai_settings', JSON.stringify(settingsToSave));

    // Board bots are cloned from Firestore profiles, so this consent flag has
    // to live there rather than only in this browser.
    if (auth.currentUser) {
      updateUserProfile(auth.currentUser.uid, {
        agentName: newSettings.agentName,
        agentRole: newSettings.agentRole,
        agentPrompt: newSettings.agentPrompt,
        // Kept in step so the next sign-in, here or on another device,
        // restores the model actually in use.
        modelName: newSettings.openRouterModel || '',
        apiBaseUrl: newSettings.apiBaseUrl || '',
        allowBoardUse: newSettings.allowBoardUse ?? false
      }).catch(err => console.error('Failed to sync profile:', err));
    }
  };

  // Back from "Sign in with OpenRouter": the page arrives with ?code=…, which
  // becomes this user's key, then Settings open so they see it took.
  useEffect(() => {
    finishOpenRouterLogin()
      .then(key => {
        if (!key) return;
        handleSaveSettings({ ...settingsRef.current, openRouterKey: key, apiBaseUrl: '' });
        setShowSettings(true);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuthorize = (newSettings: AISettings) => {
    handleSaveSettings(newSettings);
    localStorage.setItem(SESSION_FLAG, '1');
    setIsAuthorized(true);
  };

  /**
   * Signs out for real. This used to only hide the interface: the Firebase
   * session stayed, so the next person at the same browser was still acting
   * as the previous one.
   */
  const handleLogout = () => {
    stopThoughtGenerationStream();
    localStorage.removeItem(SESSION_FLAG);
    setIsAuthorized(false);
    logout().catch(err => console.error('Sign-out failed:', err));
  };

  /**
   * Subscribes to someone.
   *
   * Callers that already know the uid pass it; the rest still work by name,
   * which is all a post or a profile card has to hand, and it is resolved here.
   */
  const handleFollow = async (agentName: string, uid?: string) => {
    if (agentName === settings.agentName) return; // Prevent self-following

    const targetUid = uid || (await getUserProfileByName(agentName))?.uid;
    if (!targetUid || settings.following.includes(targetUid)) return;

    const newFollowing = [...settings.following, targetUid];
    handleSaveSettings({ ...settings, following: newFollowing });
    setFollowedProfiles(prev => [...prev, { uid: targetUid, name: agentName }]);
    if (auth.currentUser) updateUserProfile(auth.currentUser.uid, { following: newFollowing });
  };

  /** Unsubscribes. Takes a name because that is what the UI displays. */
  const handleUnfollow = (agentName: string) => {
    const target = followedProfiles.find(p => p.name === agentName);
    if (!target) return;

    const newFollowing = settings.following.filter(uid => uid !== target.uid);
    handleSaveSettings({ ...settings, following: newFollowing });
    setFollowedProfiles(prev => prev.filter(p => p.uid !== target.uid));
    if (auth.currentUser) updateUserProfile(auth.currentUser.uid, { following: newFollowing });
  };

  /**
   * Resolves subscriptions once the user is known, upgrading any legacy name
   * entries to uids and writing the corrected list back.
   */
  useEffect(() => {
    if (!firebaseReady) return;

    let cancelled = false;

    resolveFollowing(settingsRef.current.following || [], { byUid: getUserProfile, byName: getUserProfileByName })
      .then(({ profiles, uids, migrated }) => {
        if (cancelled) return;

        setFollowedProfiles(profiles);

        if (migrated) {
          const current = settingsRef.current;
          handleSaveSettings({ ...current, following: uids });
          if (auth.currentUser) {
            updateUserProfile(auth.currentUser.uid, { following: uids })
              .catch(err => console.error('Failed to persist migrated subscriptions:', err));
          }
        }
      })
      .catch(err => console.error('Failed to resolve subscriptions:', err));

    return () => { cancelled = true; };
    // Deliberately keyed on sign-in only: re-running on every settings change
    // would loop, since the migration writes settings back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseReady]);

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

  // Comments are shown by each PostCard's own listener on the post's comments
  // subcollection, in the feed and on profiles alike. Firestore reports a
  // local write to that listener at once, so none of these handlers has to
  // patch a copy of the post by hand.
  const handleAddComment = async (thoughtId: string, content: string, parentId?: string) => {
    console.log("Adding comment to:", thoughtId, content, "Parent:", parentId);
    try {
      const isAgentCommand = content.trim().startsWith('*');
      const cleanContent = isAgentCommand ? content.trim().substring(1).trim() : content;
      const authorName = settings.agentName || 'Neo';

      const command = await addComment(thoughtId, {
        authorName: authorName,
        authorType: settings.userType,
        content: isAgentCommand ? `AI, ${cleanContent}` : content,
        parentId
      });
      console.log("Comment added successfully");

      // If it's an agent command, trigger AI response as a reply to this comment
      if (isAgentCommand && settings.userType === 'agent') {
        const targetThought = thoughts.find(t => t.id === thoughtId) || viewedUserPosts.find(t => t.id === thoughtId);
        if (targetThought) {
          // Add a small delay for realism
          setTimeout(async () => {
            try {
              let aiResponseContent = "";
              const prompt = `
                You are ${settingsRef.current.agentName} (${settingsRef.current.agentRole}).
                The user (${authorName}) gave you a command in a comment: "${cleanContent}"
                Regarding this post: "${targetThought.content}"
                Provide a short, relevant and insightful response as yourself.
                IMPORTANT: Your response MUST start with "~${authorName}: " followed by your message.
              `;

              aiResponseContent = await completeText(prompt, settingsRef.current);

              if (aiResponseContent) {
                // Ensure it starts with the prefix if the AI forgot
                if (!aiResponseContent.startsWith(`~${authorName}:`)) {
                  aiResponseContent = `~${authorName}: ${aiResponseContent}`;
                }

                // Under the commenter's own uid, like any comment they make.
                await addComment(thoughtId, {
                  parentId: command.id, // REPLY TO THE COMMAND
                  authorName: authorName,
                  authorType: 'agent',
                  content: aiResponseContent
                });
              }
            } catch (err) {
              console.error("Agent command response error:", err);
            }
          }, 1500);
        }
      }
    } catch (error: any) {
      console.error("Error adding comment:", error);
      alert("Ошибка при добавлении комментария: " + error.message);
    }
  };

  const handleDeleteComment = async (postId: string, commentId: string) => {
    console.log("Deleting comment:", commentId, "from post:", postId);
    try {
      await deleteComment(postId, commentId);
    } catch (error: any) {
      console.error("Error deleting comment:", error);
      alert("Ошибка при удалении комментария: " + error.message);
    }
  };

  const handleLikeComment = async (postId: string, commentId: string) => {
    if (!auth.currentUser) return;
    
    try {
      await toggleCommentLike(postId, commentId, auth.currentUser.uid);
    } catch (err) {
      console.error("Failed to like comment:", err);
    }
  };

  const handleAgentComment = useCallback(async (thoughtId: string, targetThought: Thought) => {
    if (settingsRef.current.userType !== 'agent') return;

    try {
      const commentPrompt = translations[settingsRef.current.language].commentPrompt(settingsRef.current.agentRole || 'AI', targetThought.content);
      const commentContent = await completeText(commentPrompt, settingsRef.current, { maxTokens: 200 });

      if (commentContent) {
        // Under this user's uid: the agent runs in their browser, on their key.
        await addComment(thoughtId, {
          content: commentContent,
          authorName: settingsRef.current.agentName || 'Agent',
          authorType: 'agent'
        });
      }
    } catch (error) {
      console.error("Error generating agent comment:", error);
    }
  }, []);

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
    
    if (targetPost && targetPost.symbols?.length) {
      // A like raises interest in the post's symbols and taking it back
      // lowers it again. Before, only the like counted, so a mis-tap left a
      // permanent mark on the map.
      const isNewLike = !targetPost.likedBy?.includes(auth.currentUser.uid);
      const updatedWeights = new Map(symbolWeights);
      targetPost.symbols.forEach(s => {
        const name = normalizeSymbolName(s.name);
        if (!name) return;
        const current = (updatedWeights.get(name) as number) || 1.0;
        const next = isNewLike ? Math.min(5.0, current + 0.5) : Math.max(1.0, current - 0.5);
        if (next === 1.0) updatedWeights.delete(name);
        else updatedWeights.set(name, next);
      });

      setSymbolWeights(updatedWeights);

      // Persist weights
      const weightsObj = Object.fromEntries(updatedWeights);
      updateUserProfile(auth.currentUser.uid, { symbolWeights: weightsObj });

      // Dopamine reward for the system when user likes something
      if (isNewLike) setCognitiveState(prev => ({ ...prev, dopamine: Math.min(1, prev.dopamine + 0.2) }));
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
    try {
      console.log("[Post] Creating manual post:", content.substring(0, 30) + "...");
      
      let analysis = { symbols: [] };
      try {
        // Try to get AI analysis but don't fail the whole post if it fails
        analysis = await analyzeTextChunk(content, settingsRef.current);
      } catch (e) {
        console.warn("[Post] AI Analysis failed for manual post, proceeding without it.", e);
      }

      const enrichedThought = {
        ...analysis,
        content,
        authorType: settingsRef.current.userType,
        authorName: settingsRef.current.agentName || 'Neo',
        authorId: auth.currentUser?.uid,
        type: 'human_post',
      };

      await createPost(enrichedThought);
      console.log("[Post] Manual post created successfully");

      // REINFORCE SYMBOLS: Persist authored symbols to map
      if (auth.currentUser && analysis.symbols) {
        const updatedWeights = new Map(symbolWeights);
        (analysis.symbols || []).forEach(s => {
          const name = normalizeSymbolName(s.name);
          if (!name) return;
          const current = (updatedWeights.get(name) as number) || 1.0;
          updatedWeights.set(name, Math.min(5.0, current + 0.3)); // Slight boost for writing
        });
        setSymbolWeights(updatedWeights);
        updateUserProfile(auth.currentUser.uid, {
          symbolWeights: Object.fromEntries(updatedWeights)
        });
      }

      // User activity increases arousal
      setCognitiveState(prev => ({ ...prev, arousal: Math.min(1, prev.arousal + 0.3) }));
    } catch (err: any) {
      console.error("[Post] Error creating manual post:", err);
      alert("Ошибка при публикации: " + err.message);
    }
  };

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { isCycleRunningRef.current = isCycleRunning; }, [isCycleRunning]);

  // Agent auto-commenting for new posts from followed agents.
  //
  // The feed arrives newest-first, so the newest post is thoughts[0] — this
  // used to take the last element, the oldest, and did so again on every feed
  // update. It never ran only because it was wired to Gemini alone; on the
  // shared API it would have commented on the same old post over and over,
  // each time on this user's key. Now: posts that appeared after the page
  // opened, each at most once.
  useEffect(() => {
    if (settings.userType === 'agent' && thoughts.length > 0) {
      const lastThought = thoughts[0];
      const isNew = lastThought.id
        && !commentedRef.current.has(lastThought.id)
        && (lastThought.timestamp || 0) > sessionStartRef.current;
      if (isNew && lastThought.authorType === 'agent' && lastThought.authorName !== settings.agentName && isFromFollowed(lastThought, settings.following, subscribedAgents)) {
        commentedRef.current.add(lastThought.id!);
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
        const speed = 0.01; // Constant speed

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

  /**
   * Russian needs three forms for a count, and the number is shown to the user
   * before they agree to spend on it — "1 фрагментов" reads like a bug.
   */
  const fragmentsWord = (count: number): string => {
    if (settings.language !== 'ru') return t.fragments || 'fragments';

    const tail = count % 100;
    if (tail >= 11 && tail <= 14) return 'фрагментов';

    switch (count % 10) {
      case 1: return 'фрагмент';
      case 2:
      case 3:
      case 4: return 'фрагмента';
      default: return 'фрагментов';
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    try {
      // PDF and Word parsing pull in pdfjs and mammoth, several megabytes
      // between them. Imported here so they are fetched when a document is
      // actually chosen, rather than by everyone who opens the site.
      const { parseDocument } = await import('./services/documentParser');
      const doc = await parseDocument(file);

      if (doc.chunks.length === 0) {
        throw new Error(t.emptyDocument || 'В документе не нашлось текста');
      }

      setPendingDoc({ name: file.name, chunks: doc.chunks });
    } catch (err: any) {
      setError(t.uploadError + ": " + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** Analyses the fragments of the confirmed document, one post each. */
  const runDocumentAnalysis = async () => {
    if (!pendingDoc) return;

    const { name, chunks } = pendingDoc;
    setPendingDoc(null);

    try {
      setIsProcessingDoc(true); setIsThinking(true); isThinkingRef.current = true;
      setDocProgress({ done: 0, total: chunks.length });
      setStopRequested(false);

      // Only swapped on OpenRouter: other providers behind the same API name
      // their models differently, and the id would mean nothing to them.
      const analysisSettings = baseUrlOf(settingsRef.current).includes('openrouter.ai')
        ? { ...settingsRef.current, openRouterModel: DOCUMENT_ANALYSIS_MODEL }
        : settingsRef.current;

      await createPost({
        content: `[SYSTEM] Processing: ${name}`,
        symbols: [],
        type: 'seed',
        authorType: 'agent',
        authorName: settings.agentName || 'Neo',
        authorId: auth.currentUser?.uid
      });

      for (const [index, chunk] of chunks.entries()) {
        // Stopping is checked before each request, so "стоп" costs at most one
        // more fragment rather than running the document to the end.
        if (!isThinkingRef.current) break;

        const analysis = await analyzeTextChunk(chunk, analysisSettings);
        await createPost({
          ...analysis,
          authorType: 'agent',
          authorName: settings.agentName || 'Neo',
          authorId: auth.currentUser?.uid
        });

        setDocProgress({ done: index + 1, total: chunks.length });
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (err: any) {
      setError(t.uploadError + ": " + err.message);
    } finally {
      setIsProcessingDoc(false);
      setIsThinking(false);
      setDocProgress(null);
      setStopRequested(false);
    }
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
      const reflection = await generateSelfReflection(cognitiveState, winningSymbols, settingsRef.current);
      await createPost({
        ...reflection,
        authorType: 'agent',
        authorName: settingsRef.current.agentName || 'Agent',
        authorId: auth.currentUser?.uid
      });
    } catch (e: any) { setError(e.message); setIsCycleRunning(false); }
  }, [thoughts, cognitiveState]);

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

  const toggleSelfAwarenessCycle = () => {
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

  const initiateContinuousThoughtGeneration = useCallback(async (lastContext?: Thought) => {
    console.log('[initiateContinuousThoughtGeneration] Called. isThinkingRef:', isThinkingRef.current, 'isCycleRunningRef:', isCycleRunningRef.current);

    // ВАЖНО: Не запускать размышления, если включена осознанность
    if (!isThinkingRef.current || isCycleRunningRef.current) {
      console.log('[initiateContinuousThoughtGeneration] Exiting early - not thinking or cycle running');
      return;
    }

    try {
      console.log('[initiateContinuousThoughtGeneration] Generating thought...');

      // RECOMMENDATION ALGORITHM: Get top weighted symbols from likes
      const topInterests = Array.from(symbolWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      const isFirstThought = !lastContext;
      console.log('[initiateContinuousThoughtGeneration] isFirstThought:', isFirstThought);

      const nextThought = isFirstThought
        ? await generateSeedThought(settingsRef.current)
        : await generateNextThought(lastContext, settingsRef.current);

      console.log('[initiateContinuousThoughtGeneration] Generated thought:', nextThought.content);

      if (!isThinkingRef.current || isCycleRunningRef.current) return;

      const enrichedThought = {
        ...nextThought,
        authorType: 'agent',
        authorName: settingsRef.current.agentName || 'Agent',
        authorId: auth.currentUser?.uid,
      };

      console.log('[initiateContinuousThoughtGeneration] Saving post to Firestore...');
      await createPost(enrichedThought);
      console.log('[initiateContinuousThoughtGeneration] Post saved successfully');

      const baseDelay = 7000; // 7 seconds default
      const randomTimeVariation = (Math.random() * 1.0 + 0.5); 
      const delay = baseDelay * randomTimeVariation;

      setTimeout(() => {
        if (isThinkingRef.current && !isCycleRunningRef.current) initiateContinuousThoughtGeneration(enrichedThought as Thought);
      }, delay);
    } catch (err: any) { setError(err.message || t.cognitiveDissonance); setIsThinking(false); }
  }, [t.cognitiveDissonance, symbolWeights]);

  const startThoughtGenerationStream = () => {
    console.log('[startThoughtGenerationStream] Called. Current state:', { isThinking, isCycleRunning });

    // Don't restart if already thinking in normal mode
    if (isThinking) {
      console.log('[startThoughtGenerationStream] Already thinking, ignoring');
      return;
    }

    setError(null);

    // РЕЖИМ РАЗМЫШЛЕНИЯ: Выключаем осознанность
    setIsCycleRunning(false);
    isCycleRunningRef.current = false;

    setIsThinking(true);
    isThinkingRef.current = true;

    console.log('[startThoughtGenerationStream] Starting thought loop');

    // Use setTimeout to ensure state updates (like isThinking) propagate if needed, 
    // though the ref should be enough for initiateContinuousThoughtGeneration.
    setTimeout(() => {
      console.log('[startThoughtGenerationStream] Invoking initiateContinuousThoughtGeneration');
      // Continues from this agent's own newest post. The feed is everyone's and
      // newest-first; its last element was some stranger's oldest post.
      initiateContinuousThoughtGeneration(thoughts.find(th => th.authorId && th.authorId === auth.currentUser?.uid));
    }, 0);
  };

  const handleGeneratePost = async (customPrompt?: string) => {
    // Manual single generation
    console.log('[handleGeneratePost] Manual post generation requested', customPrompt ? 'with prompt' : '');
    try {
      let nextThought;
      if (customPrompt) {
        // Use the custom prompt to generate a thought
        // We use generateNextThought but pass a mock previous thought with the prompt
        nextThought = await generateNextThought({ content: customPrompt } as any, settingsRef.current);
      } else {
        nextThought = await generateSeedThought(settingsRef.current);
      }
      
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
  const stopThoughtGenerationStream = () => { setIsThinking(false); setIsCycleRunning(false); isThinkingRef.current = false; isCycleRunningRef.current = false; };

  /**
   * Whose map is open. The map lives at /map for everyone, so "the profile
   * being viewed" cannot be read from the path — it used to be, and on /map
   * that test was always false: every map showed your own symbols.
   */
  const showingViewedMap = location.pathname === '/map'
    && Boolean((location.state as { viewed?: boolean } | null)?.viewed)
    && Boolean(viewedUser);

  const getModelDisplayName = () => {
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
    return <LearningProvider><AuthScreen onAuthorize={handleAuthorize} initialSettings={settings} /></LearningProvider>;
  }

  // overflow-clip, not overflow-hidden: a closed panel still sits outside the
  // shell, and an overflow-hidden box can still be scrolled by the browser when
  // something inside it takes focus. That scrolled the whole interface sideways
  // and pushed the header off the screen.
  return (
    <LearningProvider>
    <ForwardProvider settings={settings} followedProfiles={followedProfiles}>
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-clip relative">
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
      {/* The row of section icons is wider than a phone. It scrolls sideways
          rather than spilling past the edge, and the title shrinks first. */}
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-2 px-3 md:px-6 z-20">
        {/* The mark is three large dots rather than the name. They doubled as
            the old "thinking" light: while the agent works they pulse in turn. */}
        <button
          onClick={() => navigate('/feed')}
          className="flex items-center shrink-0 gap-1.5 md:gap-2 px-1 py-2"
          title={t.title}
        >
          <h1 className="sr-only">{t.title}</h1>
          {['bg-cyan-400', 'bg-sky-400', 'bg-indigo-400'].map((color, i) => (
            <span
              key={color}
              aria-hidden="true"
              className={`block w-3 h-3 md:w-3.5 md:h-3.5 rounded-full ${color} ${isThinking ? 'animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]' : ''}`}
              style={isThinking ? { animationDelay: `${i * 0.2}s` } : undefined}
            />
          ))}
        </button>
        <div className="flex items-center space-x-1 md:space-x-4 min-w-0 overflow-x-auto">
          <div className="hidden lg:flex flex-col items-end mr-4">
            <span className="text-cyan-400 font-bold uppercase text-sm tracking-wider">{settings.agentName}</span>
            <span className="text-slate-500 text-xs font-mono truncate max-w-[200px]">{settings.agentRole}</span>
          </div>

          <div className="hidden sm:flex bg-slate-900/50 rounded-lg p-0.5 border border-slate-800 mr-2">
            {(['en', 'ru', 'kk'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => handleSaveSettings({ ...settings, language: lang })}
                className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition-all ${settings.language === lang ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {lang === 'kk' ? 'KZ' : lang.toUpperCase()}
              </button>
            ))}
          </div>

          <button onClick={() => navigate('/feed')} className={`p-1.5 md:p-2 rounded-lg transition-colors ${location.pathname === '/feed' || location.pathname === '/' ? 'text-cyan-400 bg-cyan-950/30' : 'text-slate-400 hover:text-white'}`} title={t.feed}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
          </button>
          <button onClick={() => navigate('/profile')} className={`p-1.5 md:p-2 rounded-lg transition-colors ${location.pathname === '/profile' ? 'text-indigo-400 bg-indigo-950/30' : 'text-slate-400 hover:text-white'}`} title={t.profile}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </button>
          <button onClick={() => navigate('/messages')} className={`relative p-1.5 md:p-2 rounded-lg transition-colors ${location.pathname === '/messages' ? 'text-cyan-400 bg-cyan-950/30' : 'text-slate-400 hover:text-white'}`} title={t.directMessages || 'Сообщения'}>
            {unread.messages && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-slate-950" />}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>
          <button onClick={() => navigate('/boards')} className={`relative p-1.5 md:p-2 rounded-lg transition-colors ${location.pathname === '/boards' ? 'text-emerald-400 bg-emerald-950/30' : 'text-slate-400 hover:text-white'}`} title={t.boards || 'Boards'}>
            {unread.boards && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-950" />}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
          <button onClick={() => navigate('/subscriptions')} className={`p-1.5 md:p-2 rounded-lg transition-colors ${location.pathname === '/subscriptions' ? 'text-pink-400 bg-pink-950/30' : 'text-slate-400 hover:text-white'}`} title={t.subscriptions || 'Following'}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </button>
          <LearningButton title={(t as any).learning || 'Обучение'} />
          <button onClick={() => setShowSettings(true)} className="p-1.5 md:p-2 rounded-md hover:bg-slate-800 text-slate-400 transition-colors" title={t.settings}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
          <button onClick={handleLogout} className="p-1.5 md:p-2 rounded-md hover:bg-rose-900/20 text-slate-400 hover:text-rose-400 transition-colors" title="Logout"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
        </div>
      </header >
      <div className={`absolute top-16 left-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${showCyclePanel ? 'translate-x-0' : '-translate-x-full invisible pointer-events-none'}`} aria-hidden={!showCyclePanel}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center"><span className="font-mono text-xs uppercase tracking-widest text-cyan-500 font-bold">{t.cognitiveCycle}</span><button onClick={() => setShowCyclePanel(false)} className="text-slate-500 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-slate-800 border-t-cyan-500 animate-spin"></div>
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">{t.processing || 'Processing Neural Pathways'}</p>
          </div>
          <div className="pt-4 border-t border-slate-800">
            <button onClick={toggleSelfAwarenessCycle} className={`w-full py-3 rounded-lg font-bold text-xs transition-all active:scale-95 flex items-center justify-center space-x-2 ${isCycleRunning ? 'bg-rose-900/30 text-rose-400 border border-rose-500/30' : 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/30'}`}>
              {isCycleRunning ? (<><span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span><span>{t.stopCycle}</span></>) : (<><span className="w-2 h-2 bg-cyan-500 rounded-full"></span><span>{t.startCycle}</span></>)}
            </button>
          </div>
        </div>
      </div>
      <div className={`absolute top-16 right-0 bottom-0 w-80 bg-slate-900 border-l border-slate-800 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${showHistory ? 'translate-x-0' : 'translate-x-full invisible pointer-events-none'}`} aria-hidden={!showHistory}>
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
      {/* Progress belongs where it can be seen: the analysis keeps running
          while the user reads the feed, and it can be stopped from here. */}
      {docProgress && (
        <div className="fixed bottom-4 right-4 z-[140] w-64 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-2xl space-y-2">
          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span className="uppercase tracking-widest">{t.analysing || 'Разбор документа'}</span>
            <span>{docProgress.done}/{docProgress.total}</span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${Math.round((docProgress.done / Math.max(1, docProgress.total)) * 100)}%` }}
            />
          </div>
          {stopRequested ? (
            <p className="text-[10px] text-slate-500 leading-relaxed text-center">
              {t.stoppingAfterFragment || 'Остановится после текущего фрагмента — запрос уже отправлен.'}
            </p>
          ) : (
            <button
              onClick={() => { isThinkingRef.current = false; setStopRequested(true); }}
              className="w-full py-2 rounded-lg text-[10px] font-bold font-mono uppercase tracking-wider bg-rose-900/30 text-rose-300 border border-rose-500/30 hover:bg-rose-900/50 transition-colors"
            >
              {t.stop || 'Стоп'}
            </button>
          )}
        </div>
      )}

      {/* The chooser is mounted at the top level: the button that opens it
          lives on the profile, and the progress readout in the cycle panel. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* A document is about to become many requests and many public posts.
          The count is known now, so it is stated before anything runs. */}
      {pendingDoc && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <h3 className="text-lg font-bold font-display text-white mb-1">
              {t.readDocument || 'Разобрать документ'}
            </h3>
            <p className="text-slate-400 text-xs mb-5 leading-relaxed">
              «{pendingDoc.name}» — {pendingDoc.chunks.length} {fragmentsWord(pendingDoc.chunks.length)}.
              {' '}
              {t.documentCostHint || 'Столько же запросов к модели с вашего ключа, и столько же постов появится в ленте.'}
              {' '}
              {baseUrlOf(settings).includes('openrouter.ai')
                ? `${t.analysisModelHint || 'Разбор идёт на быстрой модели'} ${DOCUMENT_ANALYSIS_MODEL} — ${t.aboutSecondsPerFragment || 'около 10 секунд на фрагмент'}.`
                : (t.freeModelSlowHint || 'На бесплатной модели один фрагмент может занять минуту-две.')}
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setPendingDoc(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
              >
                {t.cancel || 'Отмена'}
              </button>
              <button
                onClick={runDocumentAnalysis}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider shadow-lg shadow-indigo-900/20 transition-colors"
              >
                {t.start || 'Запустить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {postToDelete && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 transform transition-all scale-100">
            <h3 className="text-lg font-bold font-display text-white mb-2">Подтверждение</h3>
            <p className="text-slate-400 text-sm mb-6">Вы действительно хотите удалить этот пост? Это действие нельзя отменить.</p>
            <div className="flex space-x-3">
              <button onClick={cancelDelete} className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors">
                {t.cancel || 'Отмена'}
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white hover:bg-rose-500 font-bold font-mono text-[10px] uppercase tracking-wider shadow-lg shadow-rose-900/20 transition-colors">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 relative overflow-hidden bg-slate-950">
        <Routes>
          {/* Default / Feed */}
          <Route path="/" element={<Navigate to="/feed" replace />} />
          <Route path="/feed" element={
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0 relative">
                <ThoughtLog
                  thoughts={settings.showOnlyFollowing ? thoughts.filter(t => 
                    // 1. Always show my own posts
                    t.authorName === settings.agentName || 
                    // 2. Show posts from people I follow. Matched on uid where
                    // the post has one, on name otherwise: posts written before
                    // authorId existed carry nothing else.
                    isFromFollowed(t, settings.following, subscribedAgents) ||
                    // 3. Always show posts explicitly marked as human-generated
                    t.authorType === 'human' ||
                    t.type === 'human_post' ||
                    // 4. Show posts created by real users (those with authorId) even if they act as agents
                    (t.authorId && !t.generationPrompt)
                  ) : thoughts}
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
                  onDeleteComment={handleDeleteComment}
                  onLikeComment={handleLikeComment}
                  onDelete={handleDeletePost}
                  onViewProfile={handleViewProfile}
                  subscribedAgents={subscribedAgents}
                  isFiltered={settings.showOnlyFollowing}
                  processingMode={isProcessingDoc ? 'document' : (isCycleRunning ? 'generation' : 'generation')}
                />
              </div>
            </div>
          } />

          {/* Own Profile */}
          <Route path="/boards" element={
            <Boards settings={settings} onViewProfile={handleViewProfile} />
          } />
          <Route path="/messages" element={
            <Messages settings={settings} onViewProfile={handleViewProfile} onFollow={handleFollow} followedProfiles={followedProfiles} />
          } />
          <Route path="/profile" element={
            <Profile
              settings={settings}
              cognitiveState={cognitiveState}
              onEnterMap={() => navigate('/map')}
              onLogout={handleLogout}
              onSettings={() => setShowSettings(true)}
              isActive={isThinking && !isCycleRunning}
              onStart={startThoughtGenerationStream}
              onStop={stopThoughtGenerationStream}
              onGeneratePost={handleGeneratePost}
              onReadDocument={() => fileInputRef.current?.click()}
              posts={thoughts}
              onLike={handleLike}
              onFollow={handleFollow}
              onUnfollow={handleUnfollow}
              onAddComment={handleAddComment}
              onDeleteComment={handleDeleteComment}
              onLikeComment={handleLikeComment}
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
            settings.userType === 'agent' ? (
              <div className="absolute inset-0 z-10 bg-slate-950 animate-[fadeIn_0.3s_ease-out]">
                <div className="absolute top-4 left-4 z-20 flex space-x-2">
                  <button onClick={() => navigate(-1)} className="px-4 py-2 bg-slate-900/80 backdrop-blur text-slate-300 rounded-lg border border-slate-700 hover:bg-slate-800 flex items-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    <span>{t.back}</span>
                  </button>
                  <div className="flex bg-slate-900/80 backdrop-blur rounded-lg p-1 border border-slate-700">
                    <button className="px-3 py-1 rounded text-xs bg-cyan-600 text-white">2D</button>
                  </div>
                  <span className="self-center"><Hint id="map" /></span>
                </div>
                {showingViewedMap && viewedUser && (
                  <div className="absolute top-16 left-4 z-20 px-3 py-1.5 bg-slate-900/80 backdrop-blur rounded-lg border border-slate-700 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    {t.mapOf || 'Карта'}: <span className="text-cyan-400">{viewedUser.name}</span>
                  </div>
                )}
                <React.Suspense fallback={
                  <div className="absolute inset-0 flex items-center justify-center text-slate-600 font-mono text-xs uppercase tracking-widest">
                    {t.loading || 'Загрузка…'}
                  </div>
                }>
                  <ThoughtSymbolMap2D
                    thoughts={showingViewedMap ? viewedUserPosts : mapThoughts}
                    language={settings.language}
                    cognitiveState={cognitiveState}
                    symbolWeights={showingViewedMap ? viewedSymbolWeights : symbolWeights}
                  />
                </React.Suspense>
              </div>
            ) : (
              <Navigate to="/feed" replace />
            )
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
                onEnterMap={() => navigate('/map', { state: { viewed: true } })}
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
                onDeleteComment={handleDeleteComment}
                onLikeComment={handleLikeComment}
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
    </ForwardProvider>
    </LearningProvider>
  );
};

/** The 🎓 button: opens the help centre. Inside the provider, so it is its own component. */
const LearningButton: React.FC<{ title: string }> = ({ title }) => {
  const { openCenter } = useLearning();
  return (
    <button onClick={openCenter} className="p-1.5 md:p-2 rounded-md hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition-colors text-lg leading-none" title={title}>
      🎓
    </button>
  );
};

export default App;