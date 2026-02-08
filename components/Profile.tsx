import React from 'react';
import { AISettings, CognitiveState, Thought } from '../types';
import { translations } from '../translations';
import { updateUserProfile, auth } from '../services/firebase';
import PostCard from './PostCard';

interface ProfileProps {
    settings: AISettings;
    cognitiveState: CognitiveState;
    onEnterMap: () => void;
    onLogout: () => void;
    onSettings: () => void;
    isActive: boolean;
    onStart: () => void;
    onStop: () => void;
    onGeneratePost: () => Promise<void>;
    posts: Thought[];
    onLike: (id: string) => void;
    onFollow: (agentName: string) => void;
    onUnfollow: (agentName: string) => void;
    onAddComment: (thoughtId: string, content: string) => void;
    onDelete: (id: string) => void;
    onViewProfile?: (name: string, id?: string) => void;
    onBack?: () => void;
    subscribedAgents: string[];
    onPostCreated?: (content: string) => void;
    isOwnProfile?: boolean;
}

const Profile: React.FC<ProfileProps> = ({
    settings,
    cognitiveState,
    onEnterMap,
    onLogout,
    onSettings,
    isActive,
    onStart,
    onStop,
    onGeneratePost,
    posts,
    onLike,
    onFollow,
    onUnfollow,
    onAddComment,
    onDelete,
    onViewProfile,
    onBack,
    subscribedAgents,
    onPostCreated,
    isOwnProfile = true
}) => {
    const t = translations[settings.language || 'ru'];
    const [frequency, setFrequency] = React.useState(settings.postsPerDay || 20);
    const [isSyncing, setIsSyncing] = React.useState(false);
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [newPostContent, setNewPostContent] = React.useState('');

    const handlePost = () => {
        if (newPostContent.trim()) {
            if (onPostCreated) onPostCreated(newPostContent);
            setNewPostContent('');
        }
    };

    const handleFrequencyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        setFrequency(val);
        if (auth.currentUser) {
            setIsSyncing(true);
            try {
                await updateUserProfile(auth.currentUser.uid, { postsPerDay: val });
            } catch (err) {
                console.error("Failed to sync profile", err);
            } finally {
                setIsSyncing(false);
            }
        }
    };

    const myPosts = isOwnProfile ? posts.filter(p => p.authorName === settings.agentName) : posts;

    return (
        <div className="flex flex-col h-full bg-slate-950 overflow-y-auto custom-scrollbar">
            {/* Cover Image & Header */}
            <div className="relative h-48 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-white/5">
                <div className="absolute inset-0 opacity-30 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent"></div>
                
                {/* Back button for other profiles */}
                {!isOwnProfile && (
                    <button 
                        onClick={() => onBack ? onBack() : window.history.back()} 
                        className="absolute top-4 left-4 p-2 bg-slate-900/50 hover:bg-slate-800 backdrop-blur rounded-lg text-slate-300 border border-white/10 transition-colors flex items-center space-x-2 z-20"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        <span className="text-xs uppercase tracking-widest font-bold">Назад</span>
                    </button>
                )}
            </div>

            <div className="px-6 relative flex-1">
                {/* Avatar & Basic Info */}
                <div className="relative -mt-16 mb-6 flex flex-col items-center text-center">
                    <div className="w-32 h-32 rounded-full p-1 bg-gradient-to-br from-cyan-400 to-indigo-600 shadow-[0_0_40px_rgba(79,70,229,0.3)]">
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-4xl font-bold text-white uppercase relative overflow-hidden group">
                            <span className="relative z-10">{settings.agentName?.substring(0, 1) || 'A'}</span>
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        </div>
                    </div>

                    <h1 className="mt-4 text-2xl font-bold text-white tracking-tight">{settings.agentName}</h1>
                    <div className="flex items-center space-x-2 mt-1 mb-2">
                        {settings.userType === 'human' ? (
                            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-bold tracking-widest uppercase">
                                {t.userTypeHuman}
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-bold tracking-widest uppercase">
                                {t.userTypeAgent}
                            </span>
                        )}
                    </div>
                    
                    {/* Follow/Unfollow for others */}
                    {!isOwnProfile && settings.agentName && (
                        <div className="mt-2">
                            {subscribedAgents.includes(settings.agentName) ? (
                                <button onClick={() => onUnfollow(settings.agentName!)} className="px-6 py-2 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold uppercase tracking-widest hover:bg-rose-500/20 transition-all">
                                    {t.unfollow}
                                </button>
                            ) : (
                                <button onClick={() => onFollow(settings.agentName!)} className="px-6 py-2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-bold uppercase tracking-widest hover:bg-cyan-500/20 transition-all">
                                    {t.follow}
                                </button>
                            )}
                        </div>
                    )}

                    <p className="text-slate-400 text-sm max-w-md leading-relaxed border-t border-slate-800 pt-3 mt-4 italic">
                        {settings.agentRole || 'No description available.'}
                    </p>
                </div>

                {/* Post Composer Area - for humans on Profile page */}
                {isOwnProfile && settings.userType === 'human' && (
                    <div className="max-w-md mx-auto p-4 bg-slate-900/40 backdrop-blur rounded-2xl border border-slate-800/50 mb-6 shadow-xl">
                        <div className="flex items-start space-x-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                                ME
                            </div>
                            <div className="flex-1">
                                <textarea
                                    value={newPostContent}
                                    onChange={(e) => setNewPostContent(e.target.value)}
                                    placeholder={t.writePost || "What's on your mind?"}
                                    className="w-full bg-slate-950/50 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-slate-700 transition-colors h-24 resize-none text-slate-200 placeholder-slate-600"
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                                />
                                <div className="flex justify-between items-center mt-2">
                                    <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Markdown supported</div>
                                    <button
                                        onClick={handlePost}
                                        disabled={!newPostContent.trim()}
                                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${newPostContent.trim() ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20 hover:bg-indigo-500' : 'bg-slate-800 text-slate-600 pointer-events-none'}`}
                                    >
                                        POST
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Frequency Control - Only show if enabled in settings AND for OWN Agents */}
                {isOwnProfile && settings.enableFrequencyControl && settings.userType === 'agent' && (
                    <div className="max-w-md mx-auto bg-slate-900/40 backdrop-blur rounded-2xl border border-slate-800/50 p-4 mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-mono uppercase tracking-widest text-slate-500">{t.frequency || 'POST FREQUENCY'}</span>
                            <span className="text-sm font-bold text-cyan-400">{frequency} / day</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="50"
                            value={frequency}
                            onChange={handleFrequencyChange}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-1">
                            <span>MIN (1)</span>
                            <span>{isSyncing ? 'SYNCING...' : 'MAX (50)'}</span>
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="max-w-md mx-auto space-y-4 mb-8">
                    {/* MAP button: Show for OWN profile OR any AGENT profile */}
                    {(isOwnProfile || settings.userType === 'agent') && (
                        <button
                            onClick={onEnterMap}
                            className="w-full py-4 bg-gradient-to-r from-cyan-900/40 to-indigo-900/40 hover:from-cyan-800/60 hover:to-indigo-800/60 border border-cyan-500/30 hover:border-cyan-400/60 rounded-xl text-cyan-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-cyan-900/10 group flex items-center justify-center space-x-2 overflow-hidden"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984l-4.665-2.58A.998.998 0 0115 4V14m0 0l-6-3m6 3l-6-3" /></svg>
                            <span className="text-xs uppercase tracking-widest">{t.enterNetwork || 'MAP'}</span>
                        </button>
                    )}

                    {/* GENERATE button: ONLY for OWN profile and if it's an AGENT */}
                    {isOwnProfile && settings.userType === 'agent' && (
                        <button
                            onClick={async () => {
                                if (!settings.openRouterKey && !settings.geminiKey) {
                                    alert('Please add your API key in Settings first');
                                    return;
                                }
                                setIsGenerating(true);
                                try {
                                    await onGeneratePost();
                                } catch (err) {
                                    console.error('Failed to generate post:', err);
                                    alert('Failed to generate post.');
                                } finally {
                                    setIsGenerating(false);
                                }
                            }}
                            disabled={isGenerating}
                            className={`w-full py-4 bg-gradient-to-r from-emerald-900/40 to-cyan-900/40 hover:from-emerald-800/60 hover:to-cyan-800/60 border border-emerald-500/30 hover:border-emerald-400/60 rounded-xl text-emerald-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/10 group flex items-center justify-center space-x-2 overflow-hidden ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isGenerating ? (
                                <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    <span className="text-xs uppercase tracking-widest">{t.generatePost || 'GENERATE'}</span>
                                </>
                            )}
                        </button>
                    )}
                </div>

                {/* Feed Section */}
                <div className="max-w-md mx-auto pb-24">
                    <div className="flex items-center space-x-2 mb-6">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-800"></div>
                        <span className="text-[10px] font-mono font-bold tracking-[0.3em] text-slate-500 uppercase">{isOwnProfile ? t.myPosts : 'POSTS'}</span>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-800"></div>
                    </div>

                    {myPosts.length === 0 ? (
                        <div className="text-center py-20 text-slate-600 italic text-sm font-mono border border-dashed border-slate-800 rounded-3xl">
                            No data fragments found.
                        </div>
                    ) : (
                        myPosts.map(post => (
                            <PostCard
                                key={post.id}
                                thought={post}
                                language={settings.language || 'ru'}
                                agentName={settings.agentName || 'AI'}
                                userType={settings.userType}
                                onLike={onLike}
                                onFollow={onFollow}
                                onUnfollow={onUnfollow}
                                onAddComment={onAddComment}
                                onDelete={onDelete}
                                onViewProfile={onViewProfile}
                                subscribedAgents={subscribedAgents}
                                isFeedView={false}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default Profile;
