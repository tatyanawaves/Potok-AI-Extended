import React, { useState, useEffect } from 'react';
import { translations } from '../translations';
import { AISettings, CognitiveState } from '../types';

interface LaunchControlProps {
    settings: AISettings;
    isActive: boolean;
    onStart: () => void;
    onStop: () => void;
    cognitiveState: CognitiveState;
}

const LaunchControl: React.FC<LaunchControlProps> = ({
    settings,
    isActive,
    onStart,
    onStop,
    cognitiveState
}) => {
    const t = translations[settings.language || 'ru'];
    const [isHovering, setIsHovering] = useState(false);


    return (
        <div className="flex flex-col items-center justify-center h-full bg-black relative overflow-hidden">

            {/* Background Ambience */}
            <div className={`absolute inset-0 transition-opacity duration-1000 ${isActive ? 'opacity-30' : 'opacity-10'}`}>
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-[100px] animate-pulse"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="z-10 text-center space-y-12 max-w-md w-full px-6">

                {/* Header */}
                <div className="space-y-2">
                    <h1 className="text-4xl font-light tracking-tight text-white mb-1">
                        {settings.agentName}
                    </h1>
                    <p className="text-xs font-mono uppercase tracking-[0.2em] text-cyan-400/80">
                        {isActive ? t.statusActive : t.statusWaiting}
                    </p>
                </div>

                {/* Main Action Button */}
                <div
                    className="relative flex justify-center"
                    onMouseEnter={() => setIsHovering(true)}
                    onMouseLeave={() => setIsHovering(false)}
                >
                    <button
                        onClick={isActive ? onStop : onStart}
                        className={`
              relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500
              ${isActive
                                ? 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/50 text-red-400'
                                : 'bg-white/10 hover:bg-white/20 border border-white/20 text-white'
                            }
              backdrop-blur-md shadow-[0_0_50px_rgba(0,0,0,0.5)]
              hover:scale-105 active:scale-95
            `}
                    >
                        {isActive ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        )}
                    </button>

                    {/* Ripples */}
                    {!isActive && isHovering && (
                        <>
                            <div className="absolute inset-0 rounded-full border border-white/10 animate-[ping_2s_infinite]"></div>
                            <div className="absolute inset-0 rounded-full border border-white/10 animate-[ping_2s_infinite_0.5s]"></div>
                        </>
                    )}
                </div>

                <div className="text-[10px] text-slate-600 font-mono">
                    {isActive ? t.processing : t.startPrompt || 'TAP TO START PROCESS'}
                </div>

            </div>
        </div>
    );
};

export default LaunchControl;
