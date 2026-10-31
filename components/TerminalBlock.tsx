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

const LABELS = {
    ru: { failed: 'ошибка', more: (n: number) => `ещё ${n} строк`, title: 'терминал · облачная песочница', copy: 'копировать', copied: 'скопировано' },
    en: { failed: 'failed', more: (n: number) => `${n} more lines`, title: 'terminal · cloud sandbox', copy: 'copy', copied: 'copied' },
    kk: { failed: 'қате', more: (n: number) => `тағы ${n} жол`, title: 'терминал · бұлттық құмсалғыш', copy: 'көшіру', copied: 'көшірілді' }
};
type Labels = typeof LABELS.en;
const labelsOf = (language?: string): Labels => (LABELS as Record<string, Labels>)[language || 'ru'] || LABELS.ru;

const Entry: React.FC<{ entry: TerminalEntry, labels: Labels }> = ({ entry, labels }) => {
    const lines = inputLines(entry);
    const [unfolded, setUnfolded] = useState(lines.length <= FOLDED_LINES);

    return (
        // A failure is marked by more than colour: pink and green read alike on black.
        <div className={`relative px-3 py-2 border-t border-slate-800/80 first:border-t-0 ${entry.failed ? 'border-l-2 border-l-rose-500/70 bg-rose-950/20' : ''}`}>
            {entry.failed && (
                <span className="absolute top-2 right-3 text-[10px] text-rose-400">✗ {labels.failed}</span>
            )}
            <pre className={`whitespace-pre-wrap break-words ${entry.failed ? 'text-rose-300 pr-16' : 'text-emerald-300'}`}>
                {(unfolded ? lines : lines.slice(0, FOLDED_LINES)).join('\n')}
            </pre>
            {!unfolded && (
                <button onClick={() => setUnfolded(true)} className="text-[10px] text-slate-500 hover:text-slate-300">
                    … {labels.more(lines.length - FOLDED_LINES)}
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

const TerminalBlock: React.FC<{ entries: TerminalEntry[], language?: string }> = ({ entries, language }) => {
    const [copied, setCopied] = useState(false);
    const labels = labelsOf(language);

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
                <span>▸ {labels.title}</span>
                <button onClick={copy} className="hover:text-slate-300 normal-case tracking-normal">
                    {copied ? labels.copied : labels.copy}
                </button>
            </div>
            {entries.map((entry, i) => <Entry labels={labels} key={i} entry={entry} />)}
        </div>
    );
};

export default TerminalBlock;
