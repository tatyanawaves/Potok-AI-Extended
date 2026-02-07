import React, { useEffect, useRef, useState } from 'react';
import { Thought, Language } from '../types';
import { translations } from '../translations';

interface ThoughtLogProps {
  thoughts: Thought[];
  isThinking: boolean;
  language?: Language;
  processingMode?: 'generation' | 'document';
}

const ThoughtLog: React.FC<ThoughtLogProps> = ({ thoughts, isThinking, language = 'ru', processingMode = 'generation' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const t = translations[language];

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setShouldAutoScroll(isAtBottom);
    }
  };

  useEffect(() => {
    if (isThinking) {
        if (shouldAutoScroll && scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    } else if (thoughts.length > 0) {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [thoughts, isThinking, shouldAutoScroll]);

  const getTypeStyle = (type: Thought['type']) => {
    switch (type) {
      case 'seed': return 'border-cyan-500/30 bg-cyan-950/10';
      case 'evolution': return 'border-indigo-500/30 bg-indigo-950/10';
      case 'divergence': return 'border-pink-500/30 bg-pink-950/10';
      case 'conclusion': return 'border-emerald-500/30 bg-emerald-950/10';
      case 'goal': return 'border-amber-500/30 bg-amber-950/10';
      default: return 'border-slate-700 bg-slate-800/20';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border-l border-slate-800 overflow-hidden relative group">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/90 backdrop-blur z-10 sticky top-0">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400">{t.thoughtLogTitle}</h2>
        {isThinking && (
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            <span className="text-[10px] text-cyan-500 font-mono animate-pulse">{processingMode === 'document' ? t.processing : t.generating}</span>
          </div>
        )}
      </div>

      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth custom-scrollbar h-0 min-h-0"
      >
        {thoughts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
             <p className="font-mono text-[10px]">{t.thoughtLogPlaceholder}</p>
          </div>
        ) : (
          thoughts.map((thought, index) => (
            <div 
              key={thought.id} 
              className={`p-4 rounded-lg border ${getTypeStyle(thought.type)} transition-all duration-500 animate-[fadeIn_0.4s_ease-out]`}
            >
              <div className="flex justify-between items-start mb-2 opacity-40 text-[9px] font-mono uppercase tracking-tighter">
                <span>{thought.type}</span>
                <span>{new Date(thought.timestamp).toLocaleTimeString()}</span>
              </div>
              
              <p className="text-sm leading-relaxed font-light text-slate-200 mb-3">{thought.content}</p>

              {/* Meta-Cognition Details */}
              {thought.meta && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
                      {thought.meta.thought && (
                          <div className="bg-blue-500/5 p-2 rounded border-l-2 border-blue-500/40">
                              <span className="text-[9px] font-bold text-blue-400 block mb-1 uppercase">Мысль / Insight</span>
                              <p className="text-xs italic text-blue-100/80">{thought.meta.thought}</p>
                          </div>
                      )}
                      {thought.meta.feeling && (
                          <div className="bg-pink-500/5 p-2 rounded border-l-2 border-pink-500/40">
                              <span className="text-[9px] font-bold text-pink-400 block mb-1 uppercase">Чувство / Sensation</span>
                              <p className="text-xs italic text-pink-100/80">{thought.meta.feeling}</p>
                          </div>
                      )}
                      {thought.meta.goal && (
                          <div className="bg-amber-500/5 p-2 rounded border-l-2 border-amber-500/40">
                              <span className="text-[9px] font-bold text-amber-400 block mb-1 uppercase">Цель / Intent</span>
                              <p className="text-xs italic text-amber-100/80">{thought.meta.goal}</p>
                          </div>
                      )}
                      {thought.meta.motivation && (
                          <div className="bg-emerald-500/5 p-2 rounded border-l-2 border-emerald-500/40">
                              <span className="text-[9px] font-bold text-emerald-400 block mb-1 uppercase">Мотивация / Drive</span>
                              <p className="text-xs italic text-emerald-100/80">{thought.meta.motivation}</p>
                          </div>
                      )}
                  </div>
              )}

              {/* Symbols badges */}
              {thought.symbols && thought.symbols.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                      {thought.symbols.slice(0, 5).map((s, i) => (
                          <span key={i} className="text-[8px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded uppercase font-mono">#{s.name}</span>
                      ))}
                  </div>
              )}
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(71, 85, 105, 0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.5); }
      `}</style>
    </div>
  );
};

export default ThoughtLog;
