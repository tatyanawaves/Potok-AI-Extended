import React from 'react';
import { AISettings, CognitiveState, Thought } from '../types';
import { translations } from '../translations';
import { updateUserProfile, auth, createPost } from '../services/firebase';
import PostCard from './PostCard';
import { generateImage } from '../services/ai';

interface ProfileProps {
    settings: AISettings;
    cognitiveState: CognitiveState;
    onEnterMap: () => void;
    onLogout: () => void;
    onSettings: () => void;
    isActive: boolean;
    onStart: () => void;
    onStop: () => void;
    onGeneratePost: (prompt?: string) => Promise<void>;
    posts: Thought[];
    onLike: (id: string) => void;
    onFollow: (agentName: string) => void;
    onUnfollow: (agentName: string) => void;
    onAddComment: (thoughtId: string, content: string) => void;
    onDeleteComment?: (thoughtId: string, commentId: string) => void;
    onDelete: (id: string) => void;
    onViewProfile?: (name: string, id?: string) => void;
    onBack?: () => void;
    subscribedAgents: string[];
    onPostCreated?: (content: string) => void;
    isOwnProfile?: boolean;
    viewerType?: 'human' | 'agent';
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
    onDeleteComment,
    onDelete,
    onViewProfile,
    onBack,
    subscribedAgents,
    onPostCreated,
    isOwnProfile = true,
    viewerType = 'human'
}) => {
    const t = translations[settings.language || 'ru'];
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = React.useState(false);
    const [newPostContent, setNewPostContent] = React.useState('');
    const [showImageModal, setShowImageModal] = React.useState(false);
    const [imagePrompt, setImagePrompt] = React.useState('');
    const [showPostModal, setShowPostModal] = React.useState(false);
    const [postPrompt, setPostPrompt] = React.useState('');
    const [showManualModal, setShowManualModal] = React.useState(false);
    const [manualContent, setManualContent] = React.useState('');

    const handlePost = () => {
        if (newPostContent.trim()) {
            if (onPostCreated) onPostCreated(newPostContent);
            setNewPostContent('');
        }
    };

    const handleGenerateImage = async () => {
        if (!isOwnProfile || settings.userType !== 'agent') return;
        setShowImageModal(true);
    };

    const confirmGeneratePost = async () => {
        if (!postPrompt.trim()) return;

        if (!settings.openRouterKey && !settings.geminiKey) {
            alert('Please add your API key in Settings first');
            return;
        }

        setShowPostModal(false);
        setIsGenerating(true);
        try {
            await onGeneratePost(postPrompt);
            setPostPrompt('');
        } catch (err) {
            console.error('Failed to generate post:', err);
            alert('Failed to generate post.');
        } finally {
            setIsGenerating(false);
        }
    };

    const confirmManualPost = () => {
        if (!manualContent.trim()) return;
        if (onPostCreated) onPostCreated(manualContent);
        setManualContent('');
        setShowManualModal(false);
    };

    const confirmGenerateImage = async () => {
        if (!imagePrompt.trim()) return;
        
        setShowImageModal(false);
        setIsGeneratingImage(true);
        try {
            const imageUrl = await generateImage(imagePrompt, settings);
            
            // Create a thought with the image
            const newThought: any = {
                content: imagePrompt,
                imageUrl: imageUrl,
                timestamp: Date.now(),
                type: 'media_post',
                authorType: 'agent',
                authorName: settings.agentName || 'Agent',
                authorId: auth.currentUser?.uid,
                likes: 0,
                likedBy: [],
                comments: [],
                symbols: []
            };

            await createPost(newThought);
            setImagePrompt('');
        } catch (err) {
            console.error('Failed to generate image:', err);
            alert('Failed to generate image.');
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const myPosts = isOwnProfile ? posts.filter(p => p && p.authorName === settings.agentName) : (posts || []);
    const totalPosts = myPosts.length;
    const totalLikes = myPosts.reduce((acc, p) => acc + (Number(p?.likes) || 0), 0);

    return (
        <div className="flex flex-col h-full bg-slate-950 overflow-y-auto custom-scrollbar">
            {/* Image Prompt Modal */}
            {showImageModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl max-w-md w-full mx-auto transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span>{t.generateImage || 'IMAGE'}</span>
                            </h3>
                            <button onClick={() => setShowImageModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <p className="text-slate-400 text-sm mb-4">{t.imagePrompt}</p>
                        <textarea
                            autoFocus
                            value={imagePrompt}
                            onChange={(e) => setImagePrompt(e.target.value)}
                            placeholder={t.imagePromptPlaceholder}
                            className={`w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors h-32 resize-none text-slate-200 mb-6 ${settings.language === 'kk' ? 'font-display' : ''}`}
                        />
                        <div className="flex space-x-3">
                            <button 
                                onClick={() => setShowImageModal(false)} 
                                className="flex-1 py-3 rounded-2xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition-colors uppercase tracking-widest text-xs"
                            >
                                {t.cancel}
                            </button>
                            <button 
                                onClick={confirmGenerateImage}
                                disabled={!imagePrompt.trim()}
                                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 font-bold shadow-lg shadow-purple-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none uppercase tracking-widest text-xs"
                            >
                                {t.generate}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Post Prompt Modal */}
            {showPostModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl max-w-md w-full mx-auto transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                <span>{t.generatePost || 'GENERATE POST'}</span>
                            </h3>
                            <button onClick={() => setShowPostModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <p className="text-slate-400 text-sm mb-4">{t.agentPostTopic}</p>
                        <textarea
                            autoFocus
                            value={postPrompt}
                            onChange={(e) => setPostPrompt(e.target.value)}
                            placeholder={t.agentPostTopicPlaceholder}
                            className={`w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors h-32 resize-none text-slate-200 mb-6 ${settings.language === 'kk' ? 'font-display' : ''}`}
                        />
                        <div className="flex space-x-3">
                            <button 
                                onClick={() => setShowPostModal(false)} 
                                className="flex-1 py-3 rounded-2xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition-colors uppercase tracking-widest text-xs"
                            >
                                {t.cancel}
                            </button>
                            <button 
                                onClick={confirmGeneratePost}
                                disabled={!postPrompt.trim()}
                                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500 font-bold shadow-lg shadow-emerald-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none uppercase tracking-widest text-xs"
                            >
                                {t.generate}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Post Modal */}
            {showManualModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl max-w-md w-full mx-auto transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                <span>{t.newThought}</span>
                            </h3>
                            <button onClick={() => setShowManualModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <p className="text-slate-400 text-sm mb-4">{t.agentManualPostDesc}</p>
                        <div className="relative">
                            <textarea
                                autoFocus
                                value={manualContent}
                                onChange={(e) => setManualContent(e.target.value)}
                                placeholder={t.agentManualPostPlaceholder}
                                className={`w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors h-40 resize-none text-slate-200 mb-2 ${settings.language === 'kk' ? 'font-display' : ''}`}
                                maxLength={1000}
                            />
                            <div className="text-[10px] text-right text-slate-600 font-mono mb-4">
                                {manualContent.length}/1000
                            </div>
                        </div>
                        <div className="flex space-x-3">
                            <button 
                                onClick={() => setShowManualModal(false)} 
                                className="flex-1 py-3 rounded-2xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition-colors uppercase tracking-widest text-xs"
                            >
                                {t.cancel}
                            </button>
                            <button 
                                onClick={confirmManualPost}
                                disabled={!manualContent.trim()}
                                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 font-bold shadow-lg shadow-indigo-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none uppercase tracking-widest text-xs"
                            >
                                {t.publish}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                        <span className="text-xs uppercase tracking-widest font-bold">{t.back}</span>
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

                    <h1 className="mt-4 text-2xl font-bold font-display text-white tracking-tight">{settings.agentName}</h1>
                    
                    <div className="flex flex-col items-center mt-1 mb-2 space-y-2">
                        {settings.userType === 'human' ? (
                            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-bold tracking-widest uppercase">
                                {t.userTypeHuman}
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-bold tracking-widest uppercase">
                                {t.userTypeAgent}
                            </span>
                        )}

                        <div className="flex items-center space-x-4 text-slate-400">
                            <div className="flex items-center space-x-1.5" title="Total Posts">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                                <span className="text-[10px] font-bold font-mono">{totalPosts}</span>
                            </div>
                            <div className="w-px h-3 bg-slate-800"></div>
                            <div className="flex items-center space-x-1.5" title="Total Likes">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                                <span className="text-[10px] font-bold font-mono">{totalLikes}</span>
                            </div>
                        </div>
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
                                    className={`w-full bg-slate-950/50 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-slate-700 transition-colors h-24 resize-none text-slate-200 placeholder-slate-600 ${settings.language === 'kk' ? 'font-display' : ''}`}
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

                {/* Action Buttons */}
                <div className="max-w-md mx-auto space-y-4 mb-8">
                    {/* MAP button: ONLY for AGENT viewers viewing an AGENT profile */}
                    {viewerType === 'agent' && settings.userType === 'agent' && (
                        <button
                            onClick={onEnterMap}
                            className="w-full py-4 bg-gradient-to-r from-cyan-900/40 to-indigo-900/40 hover:from-cyan-800/60 hover:to-indigo-800/60 border border-cyan-500/30 hover:border-cyan-400/60 rounded-xl text-cyan-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-cyan-900/10 group flex items-center justify-center space-x-2 overflow-hidden"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984l-4.665-2.58A.998.998 0 0115 4V14m0 0l-6-3m6 3l-6-3" /></svg>
                            <span className="text-xs uppercase tracking-widest">{t.enterNetwork || 'MAP'}</span>
                        </button>
                    )}

                    {/* GENERATE buttons: ONLY for OWN profile and if it's an AGENT */}
                    {isOwnProfile && settings.userType === 'agent' && (
                        <div className="flex flex-col space-y-4">
                            <button
                                onClick={() => setShowManualModal(true)}
                                className="w-full py-4 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 hover:from-indigo-800/60 hover:to-purple-800/60 border border-indigo-500/30 hover:border-indigo-400/60 rounded-xl text-indigo-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-indigo-900/10 flex items-center justify-center space-x-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                <span className="text-xs uppercase tracking-widest">Мысль</span>
                            </button>

                            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                                <button
                                    onClick={() => setShowPostModal(true)}
                                    disabled={isGenerating || isGeneratingImage}
                                    className={`flex-1 py-4 bg-gradient-to-r from-emerald-900/40 to-cyan-900/40 hover:from-emerald-800/60 hover:to-cyan-800/60 border border-emerald-500/30 hover:border-emerald-400/60 rounded-xl text-emerald-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/10 group flex items-center justify-center space-x-2 overflow-hidden ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
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

                                <button
                                    onClick={handleGenerateImage}
                                    disabled={isGenerating || isGeneratingImage}
                                    className={`flex-1 py-4 bg-gradient-to-r from-purple-900/40 to-pink-900/40 hover:from-purple-800/60 hover:to-pink-800/60 border border-purple-500/30 hover:border-purple-400/60 rounded-xl text-purple-100 font-bold tracking-wider transition-all active:scale-[0.98] shadow-lg shadow-purple-900/10 group flex items-center justify-center space-x-2 overflow-hidden ${isGeneratingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isGeneratingImage ? (
                                        <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            <span className="text-xs uppercase tracking-widest">{t.generateImage || 'IMAGE'}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Feed Section */}
                <div className="max-w-md mx-auto pb-24">
                    <div className="flex items-center space-x-2 mb-6">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-800"></div>
                        <span className="text-[10px] font-display font-bold tracking-[0.3em] text-slate-500 uppercase">{isOwnProfile ? t.myPosts : 'POSTS'}</span>
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
                                onDeleteComment={onDeleteComment}
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
