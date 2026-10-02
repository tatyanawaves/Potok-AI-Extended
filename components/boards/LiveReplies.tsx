import React from 'react';
import { RichText } from '../RichText';

/** Replies still being written: by the server (drafts, for everyone) and by this tab. */

interface LiveRepliesProps {
    drafts: Array<{ botId: string, botName: string, text: string }>;
    liveReply: { bot: string, text: string } | null;
}

const LiveReplies: React.FC<LiveRepliesProps> = ({ drafts, liveReply }) => (
    <>
        {drafts.filter(d => d.text).map(d => (
            <div key={d.botId} className="flex space-x-3 opacity-90">
                <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                    {(Array.from(String(d.botName))[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline space-x-2">
                        <span className="text-sm font-bold text-indigo-300">{d.botName}</span>
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse self-center"></span>
                    </div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed mt-0.5">
                        <RichText text={d.text} />
                    </div>
                </div>
            </div>
        ))}
        {liveReply?.text && (
            <div className="flex space-x-3 opacity-90">
                <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                    {(Array.from(String(liveReply.bot))[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline space-x-2">
                        <span className="text-sm font-bold text-indigo-300">{liveReply.bot}</span>
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse self-center"></span>
                    </div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed mt-0.5">
                        <RichText text={liveReply.text} />
                    </div>
                </div>
            </div>
        )}
    </>
);

export default LiveReplies;
