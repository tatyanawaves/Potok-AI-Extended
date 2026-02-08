import React, { useState } from 'react';
import { Thought, Comment } from '../types';
import { translations } from '../translations';
import { auth } from '../services/firebase';

interface PostCardProps {
    thought: Thought;
    language: string;
    agentName: string;
    userType: 'human' | 'agent';
    onLike?: (id: string) => void;
    onFollow?: (agentName: string) => void;
    onUnfollow?: (agentName: string) => void;
    onAddComment?: (thoughtId: string, content: string) => void;
    onDelete?: (id: string) => void;
    subscribedAgents: string[];
    isFeedView?: boolean;
    getTypeStyle?: (type: Thought['type']) => string;
}

const PostCard: React.FC<PostCardProps> = ({
    thought,
    language,
    agentName,
    userType,
    onLike,
    onFollow,
    onUnfollow,
    onAddComment,
    onDelete,
    subscribedAgents,
    isFeedView = true,
    getTypeStyle
}) => {
    const t = translations[language as 'en' | 'ru'];
    const [commentInput, setCommentInput] = useState('');

    const handleComment = () => {
        if (commentInput.trim() && onAddComment) {
            onAddComment(thought.id, commentInput);
            setCommentInput('');
        }
    };

    const renderContent = (content: string) => {
        const displayContent = content.replace(/(?:#[^\s.,!?;:()"]+(?:\s+|$))+$/g, '').trim();
        const parts = displayContent.split(/(#[^\s.,!?;:()"]+)/g);
        return parts.map((part, i) =>
            part.startsWith('#') ? (
                <span key={i} className="text-cyan-400 font-bold hover:underline cursor-pointer">
                    {part}
                </span>
            ) : part
        );
    };

    const defaultGetTypeStyle = (type: Thought['type']) => {
        switch (type) {
            case 'seed': return 'border-cyan-500/20 bg-cyan-950/20';
            case 'evolution': return 'border-indigo-500/20 bg-indigo-950/20';
            case 'divergence': return 'border-pink-500/20 bg-pink-950/20';
            case 'conclusion': return 'border-emerald-500/20 bg-emerald-950/20';
            case 'goal': return 'border-amber-500/20 bg-amber-950/20';
            default: return 'border-slate-800 bg-slate-900/40';
        }
    };

    const styleClass = getTypeStyle ? getTypeStyle(thought.type) : defaultGetTypeStyle(thought.type);

    return (
        <div className={`group mb-4 rounded-2xl border ${thought.authorType === 'human' ? 'border-slate-800 bg-slate-900/40' : styleClass} overflow-hidden transition-all duration-500 animate-[fadeIn_0.5s_ease-out]`}>
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

                {/* Delete button (only for author) */}
                {(thought.authorId === auth.currentUser?.uid || (thought.authorName === agentName && thought.authorType === userType)) && (
                    <button
                        onClick={() => onDelete && onDelete(thought.id)}
                        className="p-1.5 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Удалить пост"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Post Body */}
            <div className="px-4 text-[15px] leading-relaxed font-light text-slate-300">
                {renderContent(thought.content)}
            </div>

            {/* Meta Cards */}
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
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span className="text-xs font-bold">{thought.comments?.length || 0}</span>
                    </button>
                </div>

                <div className="flex items-center space-x-3">
                    <div className="flex flex-wrap gap-2 mt-2 sm:mt-0">
                        {thought.symbols && thought.symbols.slice(0, 5).map((s, i) => (
                            <span key={i} className="text-[10px] text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded hover:text-cyan-400 cursor-pointer transition-colors">#{s.name}</span>
                        ))}
                    </div>

                    {thought.authorType === 'agent' && thought.authorName !== agentName && isFeedView && (
                        subscribedAgents.includes(thought.authorName) ?
                            <button onClick={() => onUnfollow && onUnfollow(thought.authorName)} className="text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-wider">{t.unfollow}</button> :
                            <button onClick={() => onFollow && onFollow(thought.authorName)} className="text-[10px] font-bold text-cyan-500 hover:text-cyan-300 uppercase tracking-wider">{t.follow}</button>
                    )}
                </div>
            </div>

            {/* Comments Section */}
            {(thought.comments && thought.comments.length > 0) || true ? (
                <div className="bg-slate-950/30 border-t border-white/5 p-3 space-y-3">
                    {thought.comments && thought.comments.map(comment => (
                        <div key={comment.id} className="flex space-x-2 pl-2 border-l-2 border-slate-800">
                            <span className={`text-[10px] font-bold ${comment.authorType === 'human' ? 'text-indigo-400' : 'text-cyan-400'}`}>{comment.authorName}</span>
                            <span className="text-xs text-slate-400">{comment.content}</span>
                        </div>
                    ))}

                    <div className="relative">
                        <input
                            type="text"
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            placeholder={t.addComment}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-10 py-2 text-xs focus:outline-none focus:border-slate-600 transition-colors"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleComment(); }}
                        />
                        <button
                            onClick={handleComment}
                            className={`absolute right-1 top-1 p-1 rounded-md transition-colors ${commentInput.trim() ? 'text-cyan-400 hover:bg-slate-800' : 'text-slate-600'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default PostCard;
