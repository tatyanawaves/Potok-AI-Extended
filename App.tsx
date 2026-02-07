import React, { useState, useRef, useEffect, useCallback } from 'react';
import ThoughtGraph3D from './components/ThoughtGraph3D';
import ThoughtLog from './components/ThoughtLog';
import SettingsModal from './components/SettingsModal';
import { generateSeedThought, generateNextThought, analyzeTextChunk, generateSelfReflection } from './services/ai';
import { parseDocument } from './services/documentParser';
import { Thought, SavedSession, AIProvider, AISettings, CognitiveState } from './types';
import { translations } from './translations';

const App: React.FC = () => {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [isCycleRunning, setIsCycleRunning] = useState(false);
  const [showCyclePanel, setShowCyclePanel] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('openrouter');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  
  const [cognitiveState, setCognitiveState] = useState<CognitiveState>({
    valence: 0, 
    arousal: 0.8, // High arousal at birth
    entropy: 1.0, // Maximum chaos initially
    complexity: 0,
    predictionError: 1.0, // Maximum surprise
    dopamine: 0.5, // Initial burst
    peakDopamine: 0.5,
    avgDopamine: 0.5,
    dopamineHistory: [0.5]
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const isThinkingRef = useRef(isThinking);
  const isCycleRunningRef = useRef(isCycleRunning);
  
  const [settings, setSettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('ai_settings');
    return saved ? JSON.parse(saved) : {
      openRouterKey: '', openRouterModel: 'arcee-ai/trinity-large-preview:free',
      language: 'ru', decaySpeed: 1.0
    };
  });
  const settingsRef = useRef(settings);

  const t = translations[settings.language || 'ru'];

  useEffect(() => {
    document.title = t.title;
    document.documentElement.lang = settings.language || 'ru';
  }, [t.title, settings.language]);

  const handleSaveSettings = (newSettings: AISettings) => {
    setSettings(newSettings);
    settingsRef.current = newSettings;
    localStorage.setItem('ai_settings', JSON.stringify(newSettings));
  };

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { isCycleRunningRef.current = isCycleRunning; }, [isCycleRunning]);

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
    const newSession: SavedSession = {
      id: crypto.randomUUID(), timestamp: Date.now(),
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
        setThoughts([{ id: crypto.randomUUID(), content: `[SYSTEM] Processing: ${file.name}`, symbols: [], timestamp: Date.now(), type: 'seed' }]);
        for (const chunk of doc.chunks) {
            if (!isThinkingRef.current) break;
            const analysis = await analyzeTextChunk(provider, chunk, settingsRef.current);
            setThoughts(prev => [...prev, analysis]);
            await new Promise(r => setTimeout(r, 800));
        }
    } catch (err: any) { setError(t.uploadError + ": " + err.message); }
    finally { setIsProcessingDoc(false); setIsThinking(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const runCognitiveStep = useCallback(async () => {
      const symbolStats = new Map<string, {count: number, cat: string}>();
      thoughts.forEach(t => {
          t.symbols.forEach(s => {
              const cur = symbolStats.get(s.name) || {count: 0, cat: s.category};
              symbolStats.set(s.name, {count: cur.count + 1, cat: s.category});
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
          if (isCycleRunningRef.current || isThinkingRef.current) {
              setThoughts(prev => [...prev, reflection]);
          }
      } catch (e: any) { setError(e.message); setIsCycleRunning(false); }
  }, [provider, thoughts, cognitiveState]);

  useEffect(() => {
      let timeoutId: any;
      const cycle = async () => {
          if (!isCycleRunningRef.current) return;
          setIsThinking(true); isThinkingRef.current = true;
          await runCognitiveStep();
          setIsThinking(false); isThinkingRef.current = false;
          if (isCycleRunningRef.current) timeoutId = setTimeout(cycle, 4000);
      };
      if (isCycleRunning) cycle();
      return () => clearTimeout(timeoutId);
  }, [isCycleRunning, runCognitiveStep]);

  const handleToggleCycle = () => {
      if (!isCycleRunning) {
          setShowCyclePanel(true); setIsCycleRunning(true); isCycleRunningRef.current = true;
      } else {
          setIsCycleRunning(false); isCycleRunningRef.current = false;
      }
  };

  const processThoughtLoop = useCallback(async (currentProvider: AIProvider, lastContext?: Thought) => {
    if (!isThinkingRef.current || isCycleRunningRef.current) return;
    try {
      const isFirstThought = !lastContext;
      const nextThought = isFirstThought 
        ? await generateSeedThought(currentProvider, settingsRef.current)
        : await generateNextThought(currentProvider, lastContext, settingsRef.current);
      
      if (!isThinkingRef.current) return;
      setThoughts(prev => [...prev, nextThought]);

      // If it was the awakening, trigger immediate meta-reflection
      if (isFirstThought) {
          // System already started the cycle in handleStart, 
          // just wait a bit for the first thought to be visible
          await new Promise(r => setTimeout(r, 1500));
      }

      setTimeout(() => { 
          if (isThinkingRef.current && !isCycleRunningRef.current) processThoughtLoop(currentProvider, nextThought); 
      }, 3000);
    } catch (err: any) { setError(err.message || t.cognitiveDissonance); setIsThinking(false); }
  }, [t.cognitiveDissonance, runCognitiveStep, provider]);

  const handleStart = () => { 
      if (isThinking) return;
      setError(null); 
      
      // 1. TURN ON NEUROBIOLOGY IMMEDIATELY
      setShowCyclePanel(true);
      setIsCycleRunning(true);
      isCycleRunningRef.current = true;
      
      // 2. INITIALIZE THINKING
      setIsThinking(true); 
      isThinkingRef.current = true;
      
      // 3. START THOUGHT LOOP (If empty, it will trigger [AWAKENING])
      processThoughtLoop(provider, thoughts[thoughts.length - 1]); 
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden relative">
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
      <header className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 z-20">
        <div className="flex items-center space-x-3">
            <div className={`w-3 h-3 rounded-full ${isThinking ? 'bg-cyan-500 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]' : 'bg-slate-700'}`}></div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">{t.title}</h1>
        </div>
        <div className="flex items-center space-x-4">
             <div className="hidden md:flex space-x-4 text-xs font-mono text-slate-500 mr-4">
                <button onClick={() => !isThinking && setProvider(provider === 'gemini' ? 'openrouter' : 'gemini')} className={`transition-colors ${isThinking ? 'cursor-not-allowed opacity-50' : 'hover:text-cyan-400'}`} disabled={isThinking}>{t.model}: {getModelDisplayName()}</button>
                <span>{t.status}: {isThinking ? (isProcessingDoc ? t.processing : t.statusActive) : t.statusWaiting}</span>
            </div>
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-md hover:bg-slate-800 text-slate-400 transition-colors" title={t.settings}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
            <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-md transition-colors ${showHistory ? 'bg-slate-800 text-cyan-400' : 'hover:bg-slate-800 text-slate-400'}`} title={t.history}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
        </div>
      </header>
      <div className={`absolute top-16 left-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${showCyclePanel ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center"><span className="font-mono text-xs uppercase tracking-widest text-cyan-500 font-bold">{t.cognitiveCycle}</span><button onClick={() => setShowCyclePanel(false)} className="text-slate-500 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            <div className="space-y-4">
                <h3 className="text-[10px] font-mono text-slate-400 uppercase tracking-tighter">{t.internalSensors}</h3>
                <SensorBar label={t.valence} value={(cognitiveState.valence + 1) / 2} color={cognitiveState.valence > 0 ? 'bg-emerald-500' : 'bg-rose-500'} />
                <SensorBar label={t.arousal} value={cognitiveState.arousal} color="bg-orange-500" />
                
                <div className="pt-2 border-t border-slate-800/50 space-y-4">
                    <h3 className="text-[10px] font-mono text-purple-400 uppercase tracking-tighter">Dopamine System</h3>
                    <SensorBar label="Activation" value={cognitiveState.dopamine} color="bg-purple-500" />
                    <SensorBar label="Peak" value={cognitiveState.peakDopamine} color="bg-purple-400" />
                    <SensorBar label="Average" value={cognitiveState.avgDopamine} color="bg-purple-600" />
                </div>

                <div className="pt-2 border-t border-slate-800/50 space-y-4">
                    <SensorBar label={t.entropy} value={cognitiveState.entropy} color="bg-slate-500" />
                    <SensorBar label={t.complexity} value={cognitiveState.complexity} color="bg-blue-500" />
                </div>
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
      <main className={`flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden transition-all duration-300 ${showHistory ? 'lg:mr-80' : ''} ${showCyclePanel ? 'lg:ml-72' : ''}`}>
        <div className="lg:col-span-2 h-[50vh] lg:h-full p-4 md:p-6 bg-slate-950 relative border-b lg:border-b-0 lg:border-r border-slate-800 z-10">
           <ThoughtGraph3D thoughts={thoughts} language={settings.language} cognitiveState={cognitiveState} />
           {error && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="bg-red-900/20 border border-red-500/50 p-6 rounded-lg max-w-md text-center"><h3 className="text-red-400 font-mono text-lg mb-2">{t.systemError}</h3><p className="text-red-200/80 mb-4">{error}</p><button onClick={() => setError(null)} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded transition-colors">{t.close}</button></div></div>}
        </div>
        <div className="lg:col-span-1 h-full relative overflow-hidden flex flex-col border-l border-slate-800">
            <div className="flex-1 min-h-0 relative">
                <ThoughtLog thoughts={thoughts} isThinking={isThinking} language={settings.language} processingMode={isProcessingDoc ? 'document' : (isCycleRunning ? 'generation' : 'generation')} />
            </div>
            <div className="p-6 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent flex flex-col justify-end items-center h-40 pointer-events-none absolute bottom-0 left-0 right-0">
                <div className="pointer-events-auto flex space-x-3 items-center">
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".pdf,.docx,.txt" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={isThinking} className={`p-3 border rounded-lg transition-all active:scale-95 ${isThinking ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'}`} title={t.uploadDoc}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></button>
                    <button onClick={handleNewProcess} className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all active:scale-95" title={t.newProcess}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg></button>
                    {!isThinking || isCycleRunning ? (<>
                            <button onClick={handleStart} className="group relative px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-[0_0_20px_rgba(8,145,178,0.4)] transition-all active:scale-95 min-w-[140px]"><span className="flex items-center justify-center space-x-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg><span>{thoughts.length > 0 ? t.continue : t.start}</span></span></button>
                            {thoughts.length > 3 && <button onClick={handleToggleCycle} className={`px-4 py-3 text-white font-bold rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center space-x-2 ${isCycleRunning ? 'bg-rose-600 hover:bg-rose-500' : 'bg-purple-600 hover:bg-purple-500'}`} title={t.selfAwareness}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg></button>}
                        </>) : <button onClick={handleStop} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center space-x-2 min-w-[160px]"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg><span>{t.stop}</span></button>}
                    <button onClick={saveCurrentSession} disabled={thoughts.length === 0} className={`p-3 border rounded-lg transition-all active:scale-95 ${thoughts.length === 0 ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-slate-800 hover:bg-indigo-900/50 border-slate-700 text-indigo-400'}`} title={t.saveProcess}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg></button>
                </div>
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;