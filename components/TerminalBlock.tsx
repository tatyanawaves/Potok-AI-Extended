import React, { useState } from 'react';
import { TerminalEntry } from '../types';
import { stripAnsi } from '../services/terminal';

/**
 * What ran in a cloud sandbox for one message, drawn as a terminal: the
 * command or code at a prompt, then what it printed. See services/terminal.ts.
 */

const PROMPT: Record<TerminalEntry['kind'], string> = {
    shell: '$',
    python: '>>>',
    javascript: 'js›',
    write_file: '✎',
    read_file: 'cat'
};

/** Code taller than this is folded until asked for. */
const FOLDED_LINES = 12;

const inputLines = (entry: TerminalEntry): string[] => {
    const lines = entry.input.split('\n');
    // A Python session shows continuation lines the way the REPL does.
    if (entry.kind === 'python') return lines.map((line, i) => `${i === 0 ? '>>>' : '...'} ${line}`);
    return lines.map((line, i) => `${i === 0 ? PROMPT[entry.kind] : ' '.repeat(PROMPT[entry.kind].length)} ${line}`);
};

const asText = (entries: TerminalEntry[]): string =>
    entries.map(entry => `${inputLines(entry).join('\n')}\n${entry.output}`).join('\n\n');

const Entry: React.FC<{ entry: TerminalEntry }> = ({ entry }) => {
    const lines = inputLines(entry);
    const [unfolded, setUnfolded] = useState(lines.length <= FOLDED_LINES);

    return (
        // A failure is marked by more than colour: pink and green read alike on black.
        <div className={`relative px-3 py-2 border-t border-slate-800/80 first:border-t-0 ${entry.failed ? 'border-l-2 border-l-rose-500/70 bg-rose-950/20' : ''}`}>
            {entry.failed && (
                <span className="absolute top-2 right-3 text-[10px] text-rose-400">✗ ошибка</span>
            )}
            <pre className={`whitespace-pre-wrap break-words ${entry.failed ? 'text-rose-300 pr-16' : 'text-emerald-300'}`}>
                {(unfolded ? lines : lines.slice(0, FOLDED_LINES)).join('\n')}
            </pre>
            {!unfolded && (
                <button onClick={() => setUnfolded(true)} className="text-[10px] text-slate-500 hover:text-slate-300">
                    … ещё {lines.length - FOLDED_LINES} строк
                </button>
            )}
            {entry.output && (
                <pre className={`mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words ${entry.failed ? 'text-rose-200/80' : 'text-slate-300'}`}>
                    {stripAnsi(entry.output)}
                </pre>
            )}
        </div>
    );
};

const TerminalBlock: React.FC<{ entries: TerminalEntry[] }> = ({ entries }) => {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(asText(entries));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard refused: nothing to do */ }
    };

    return (
        <div className="mt-2 rounded-lg border border-slate-700/70 bg-black/70 font-mono text-[12px] leading-relaxed overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1 border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                <span>▸ терминал · облачная песочница</span>
                <button onClick={copy} className="hover:text-slate-300 normal-case tracking-normal">
                    {copied ? 'скопировано' : 'копировать'}
                </button>
            </div>
            {entries.map((entry, i) => <Entry key={i} entry={entry} />)}
        </div>
    );
};

export default TerminalBlock;
