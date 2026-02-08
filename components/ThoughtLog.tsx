import React, { useEffect, useRef, useState } from 'react';
import { Thought, Language } from '../types';
import { translations } from '../translations';
import PostCard from './PostCard';

interface ThoughtLogProps {
  thoughts: Thought[];
  isThinking: boolean;
  language?: Language;
  processingMode?: 'generation' | 'document';
  agentName?: string;
  userType?: 'human' | 'agent';
  onLike?: (id: string) => void;
  onFollow?: (agentName: string) => void;
  onUnfollow?: (agentName: string) => void;
  onAddComment?: (thoughtId: string, content: string) => void;
  onDelete?: (id: string) => void;
  onViewProfile?: (name: string, id?: string) => void;
  subscribedAgents?: string[];
  symbolWeights?: Map<string, number>;
  onPostCreated?: (content: string) => void;
}

const ThoughtLog: React.FC<ThoughtLogProps> = ({
  thoughts,
  isThinking,
  language = 'ru',
  processingMode = 'generation',
  agentName = 'AI',
  userType = 'agent',
  onLike,
  onFollow,
  onUnfollow,
  onAddComment,
  onDelete,
  onViewProfile,
  subscribedAgents = [],
  symbolWeights = new Map(),
  onPostCreated
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const t = translations[language];

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShouldAutoScroll(isAtBottom);
    }
  };

  useEffect(() => {
    if (isThinking) {
      if (shouldAutoScroll && scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [thoughts, isThinking, shouldAutoScroll]);

  const getTypeStyle = (type: Thought['type']) => {
    switch (type) {
      case 'seed': return 'border-cyan-500/20 bg-cyan-950/20';
      case 'evolution': return 'border-indigo-500/20 bg-indigo-950/20';
      case 'divergence': return 'border-pink-500/20 bg-pink-950/20';
      case 'conclusion': return 'border-emerald-500/20 bg-emerald-950/20';
      case 'goal': return 'border-amber-500/20 bg-amber-950/20';
      default: return 'border-slate-800 bg-slate-900/40';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 relative">
      {/* Top Bar for Feed Title (Mobile only mostly) */}
      <div className="md:hidden p-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20 flex justify-between items-center">
        <h1 className="text-lg font-bold text-white tracking-tight">{t.title}</h1>
        {isThinking && <div className="animate-pulse text-xs text-cyan-400 font-mono">{t.generating}...</div>}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth"
      >
        <div className="max-w-xl mx-auto pt-6 pb-24 px-4 md:px-0">
          {thoughts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 opacity-50 text-xs font-mono uppercase tracking-widest">
              Connecting to Neural Stream...
            </div>
          ) : (
            thoughts
              .map((thought) => (
                <PostCard
                  key={thought.id}
                  thought={thought}
                  language={language}
                  agentName={agentName}
                  userType={userType}
                  onLike={onLike}
                  onFollow={onFollow}
                  onUnfollow={onUnfollow}
                  onAddComment={onAddComment}
                  onDelete={onDelete}
                  onViewProfile={onViewProfile}
                  subscribedAgents={subscribedAgents}
                  getTypeStyle={getTypeStyle}
                />
              ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
    </div>
  );
};

export default ThoughtLog;
