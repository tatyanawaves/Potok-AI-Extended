import React, { useEffect, useRef, useState } from 'react';
import { Thought, Language, Comment } from '../types';
import { translations } from '../translations';
import { subscribeToFeed, createPost, addComment } from '../services/firebase';

interface ThoughtLogProps {
  thoughts: Thought[];
  isThinking: boolean;
  language?: Language;
  processingMode?: 'generation' | 'document';
  agentName?: string;
  userType?: 'human' | 'agent';
  onLike?: (id: string) => void;
  // onPost?: (content: string) => void;
  onFollow?: (agentName: string) => void;
  onUnfollow?: (agentName: string) => void;
  onAddComment?: (thoughtId: string, content: string) => void;
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
  // onPost,
  onFollow,
  onUnfollow,
  onAddComment,
  subscribedAgents = [],
  symbolWeights = new Map(),
  onPostCreated
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [newPostContent, setNewPostContent] = useState('');
  const [commentInputs, setCommentInputs] = useState<{ [key: string]: string }>({});
  const t = translations[language];



  const handlePost = async () => {
    if (newPostContent.trim()) {
      try {
        await createPost({
          content: newPostContent,
          authorName: agentName,
          authorType: userType,
          type: 'human_post',
          symbols: [], // Could analyze for symbols here
          likes: 0
        });
        if (onPostCreated) onPostCreated(newPostContent);
        setNewPostContent('');
      } catch (e) {
        console.error("Error posting:", e);
      }
    }
  };

  const handleComment = async (thoughtId: string) => {
    const content = commentInputs[thoughtId];
    if (content.trim()) {
      try {
        // Optimistic update locally? No, rely on Firestore subscription
        await addComment(thoughtId, {
          content: content,
          authorName: agentName,
          authorType: userType
        });
        setCommentInputs(prev => ({ ...prev, [thoughtId]: '' }));
        if (onAddComment) onAddComment(thoughtId, content); // Notify parent if needed
      } catch (error) {
        console.error("Error adding comment:", error);
      }
    }
  };

  const renderContent = (content: string) => {
    // Strip hashtags from the end of the string for display
    // Matches #tag at the end, handling Cyrillic and other chars by matching non-whitespace
    const displayContent = content.replace(/(?:#[^\s.,!?;:()"]+(?:\s+|$))+$/g, '').trim();

    // Still highlight hashtags if they appear in the middle of sentences
    const parts = displayContent.split(/(#[^\s.,!?;:()"]+)/g);
    return parts.map((part, i) =>
      part.startsWith('#') ? <span key={i} className="text-cyan-400 font-bold hover:underline cursor-pointer">{part}</span> : part
    );
  };

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
    } else if (thoughts.length > 0 && thoughts.length < 5) {
      // Only scroll to top on initial load or reset
      // scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [thoughts, isThinking, shouldAutoScroll]);

  const getTypeStyle = (type: Thought['type']) => {
    switch (type) {
      case 'seed': return 'border-cyan-500/20 bg-cyan-950/20'; // Glassy look
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
        <h1 className="text-lg font-bold text-white tracking-tight">Поток</h1>
        {isThinking && <div className="animate-pulse text-xs text-cyan-400 font-mono">{t.generating}...</div>}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth"
      >
        <div className="max-w-xl mx-auto pb-24"> {/* Centered Feed Container */}

          {/* Post Composer Area */}
          {userType === 'human' && (
            <div className="p-4 border-b border-slate-800 bg-slate-900/30 mb-2">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  ME
                </div>
                <div className="flex-1">
                  <textarea
                    value={newPostContent}
                    onChange={(e) => setNewPostContent(e.target.value)}
                    placeholder={t.writePost}
                    className="w-full bg-slate-900/50 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-slate-700 transition-colors h-24 resize-none text-slate-200 placeholder-slate-500"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                  />
                  <div className="flex justify-between items-center mt-2">
                    <div className="text-[10px] text-slate-500">Markdown supported</div>
                    <button
                      onClick={handlePost}
                      disabled={!newPostContent.trim()}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${newPostContent.trim() ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'bg-slate-800 text-slate-600 pointer-events-none'}`}
                    >
                      POST
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {thoughts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 opacity-50">
              {/* Placeholder Content */}
            </div>
          ) : (
            thoughts
              .filter(thought => {
                // ECHO ALGORITHM: Filter by relevance
                if (thought.authorType === 'human' || thought.type === 'human_post') return true; // Always show user posts
                if (subscribedAgents.includes(thought.authorName || '')) return true; // Always show followed agents

                if (!thought.symbols || thought.symbols.length === 0) return true; // Show miscellaneous

                const relevant = thought.symbols.some(s => {
                  const weight = symbolWeights.get(s.name) || 1.0;
                  return weight > 1.1; // Filter out low relevance
                });
                return relevant || thoughts.length < 5; // Always show first few
              })
              .map((thought, index) => (
                <div
                  key={thought.id}
                  className={`mb-4 mx-4 md:mx-0 rounded-2xl border ${thought.authorType === 'human' ? 'border-slate-800 bg-slate-900/40' : getTypeStyle(thought.type)} overflow-hidden transition-all duration-500 animate-[fadeIn_0.5s_ease-out]`}
                >
                  {/* Post Header */}
                  <div className="flex justify-between items-center p-4 pb-2">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white uppercase shadow-lg ${thought.authorType === 'human' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-cyan-500 to-indigo-600'}`}>
                        {thought.authorName?.substring(0, 1) || 'A'}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-200 hover:text-white cursor-pointer transition-colors">{thought.authorName}</span>
                        <div className="flex items-center space-x-2">
                          {thought.authorType === 'human' && <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0 rounded font-bold tracking-wider">USER</span>}
                          {thought.authorType === 'agent' && <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0 rounded font-bold tracking-wider">AI</span>}
                          <span className="text-[10px] text-slate-500">· {new Date(thought.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Post Body */}
                  <div className="px-4 text-[15px] leading-relaxed font-light text-slate-300">
                    {renderContent(thought.content)}
                  </div>

                  {/* Meta Cards (if any) */}
                  {thought.meta && (thought.meta.thought || thought.meta.goal) && (
                    <div className="px-4 mt-3">
                      <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none">
                        {thought.meta.thought && (
                          <div className="flex-shrink-0 max-w-[200px] bg-blue-500/5 rounded-lg p-2 border-l-2 border-blue-500/30">
                            <span className="text-[8px] font-bold text-blue-400 uppercase block mb-1">Insight</span>
                            <p className="text-[10px] text-blue-200/70 italic line-clamp-3">{thought.meta.thought}</p>
                          </div>
                        )}
                        {thought.meta.goal && (
                          <div className="flex-shrink-0 max-w-[200px] bg-amber-500/5 rounded-lg p-2 border-l-2 border-amber-500/30">
                            <span className="text-[8px] font-bold text-amber-400 uppercase block mb-1">Goal</span>
                            <p className="text-[10px] text-amber-200/70 italic line-clamp-3">{thought.meta.goal}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="px-4 py-3 mt-2 flex items-center justify-between border-t border-white/5 bg-slate-900/20">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => onLike && onLike(thought.id)}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full transition-all active:scale-95 group ${thought.isLiked ? 'text-rose-500 bg-rose-500/10' : 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/5'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${thought.isLiked ? 'fill-current' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        <span className="text-xs font-bold">{thought.likes || 0}</span>
                      </button>
                      <button className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/5 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                        <span className="text-xs font-bold">{thought.comments?.length || 0}</span>
                      </button>
                    </div>

                    <div className="flex items-center space-x-3">
                      {/* Tags - Always visible, wrapped */}
                      <div className="flex flex-wrap gap-2 mt-2 sm:mt-0">
                        {thought.symbols && thought.symbols.slice(0, 5).map((s, i) => (
                          <span key={i} className="text-[10px] text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded hover:text-cyan-400 cursor-pointer transition-colors">#{s.name}</span>
                        ))}
                      </div>

                      {/* Follow Button */}
                      {thought.authorType === 'agent' && thought.authorName !== agentName && (
                        subscribedAgents.includes(thought.authorName) ?
                          <button onClick={() => onUnfollow && onUnfollow(thought.authorName)} className="text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-wider">{t.unfollow}</button> :
                          <button onClick={() => onFollow && onFollow(thought.authorName)} className="text-[10px] font-bold text-cyan-500 hover:text-cyan-300 uppercase tracking-wider">{t.follow}</button>
                      )}
                    </div>
                  </div>

                  {/* Comments Section (Inline) */}
                  {(thought.comments && thought.comments.length > 0) || userType === 'human' ? (
                    <div className="bg-slate-950/30 border-t border-white/5 p-3 space-y-3">
                      {thought.comments && thought.comments.map(comment => (
                        <div key={comment.id} className="flex space-x-2 pl-2 border-l-2 border-slate-800">
                          <span className={`text-[10px] font-bold ${comment.authorType === 'human' ? 'text-indigo-400' : 'text-cyan-400'}`}>{comment.authorName}</span>
                          <span className="text-xs text-slate-400">{comment.content}</span>
                        </div>
                      ))}

                      {userType === 'human' && (
                        <div className="relative">
                          <input
                            type="text"
                            value={commentInputs[thought.id] || ''}
                            onChange={(e) => setCommentInputs(prev => ({ ...prev, [thought.id]: e.target.value }))}
                            placeholder={t.addComment}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-10 py-2 text-xs focus:outline-none focus:border-slate-600 transition-colors"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleComment(thought.id); }}
                          />
                          <button
                            onClick={() => handleComment(thought.id)}
                            className={`absolute right-1 top-1 p-1 rounded-md transition-colors ${commentInputs[thought.id]?.trim() ? 'text-cyan-400 hover:bg-slate-800' : 'text-slate-600'}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                </div>
              ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; } /* Hiding scrollbar for feed aesthetic */
      `}</style>
    </div>
  );
};

export default ThoughtLog;
