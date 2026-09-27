import React from 'react';

export type Segment =
    | { kind: 'text'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'bold'; text: string }
    | { kind: 'block'; text: string; lang: string };

const FENCE = /```([\w+-]*)[^\S\n]*\n?([\s\S]*?)(?:\n?```|$)/g;
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*/g;

const inline = (text: string): Segment[] => {
    const out: Segment[] = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
        if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        out.push(m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'bold', text: m[2] });
        last = m.index! + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
    return out;
};

/** Splits bot-style markdown into fenced blocks, inline code and bold; everything else stays text. */
export const parseRichText = (text: string): Segment[] => {
    const out: Segment[] = [];
    let last = 0;
    for (const m of text.matchAll(FENCE)) {
        if (m.index! > last) out.push(...inline(text.slice(last, m.index).replace(/\n$/, '')));
        out.push({ kind: 'block', lang: m[1], text: m[2].replace(/\n$/, '') });
        last = m.index! + m[0].length;
        if (text[last] === '\n') last++;
    }
    if (last < text.length) out.push(...inline(text.slice(last)));
    return out;
};

export const RichText: React.FC<{ text: string }> = ({ text }) => (
    <>
        {parseRichText(text).map((s, i) => {
            if (s.kind === 'block') return (
                <pre key={i} className="my-1.5 rounded-md bg-black/60 border border-slate-800 px-3 py-2 text-xs font-mono text-slate-200 whitespace-pre-wrap break-words overflow-x-auto">{s.text}</pre>
            );
            if (s.kind === 'code') return <code key={i} className="rounded bg-slate-800/80 px-1 py-px text-[0.9em] font-mono text-cyan-200">{s.text}</code>;
            if (s.kind === 'bold') return <strong key={i} className="font-semibold text-slate-100">{s.text}</strong>;
            return <React.Fragment key={i}>{s.text}</React.Fragment>;
        })}
    </>
);
