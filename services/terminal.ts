import { TerminalEntry } from '../types';

/**
 * The terminal in board chat.
 *
 * Commands run in the user's own cloud sandbox — E2B or Daytona, on their
 * key, through the worker (worker/src/sandbox.ts) — never on anyone's
 * computer. What ran and what it printed is kept on the message that ran it
 * and shown as a terminal block, so the whole board sees it, bots included.
 *
 * Two ways in: a bot's sandbox tool calls during its turn, and a person
 * typing /sh, /py or /js in a channel or pressing ▶ on a code block. These
 * are the pure parts; ./sandboxRun does the running.
 */

/** Longest command or code kept on a message. */
export const MAX_INPUT = 2000;
/** Longest output kept per entry; the sandbox itself cuts at 8000. */
export const MAX_OUTPUT = 4000;
/** Most entries kept on one message: the last ones, which hold the outcome. */
export const MAX_ENTRIES = 8;

export type RunKind = 'shell' | 'python' | 'javascript';

/** Something a person asked to run. */
export interface RunRequest {
    kind: RunKind;
    input: string;
}

const clip = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}\n… (обрезано)` : text;

/**
 * Terminal colour and cursor codes, which programs such as pip print even
 * without a terminal. Shown raw they are noise (`\u001b[33mWARNING`).
 */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, '');

/** A shell command's output from worker/src/sandbox.ts starts with its exit code. */
const exitedWithError = (output: string): boolean => /^exit\s+[1-9]\d*\b/.test(output.trimStart());

/** A sandbox tool call as a terminal entry; null for any other tool. */
export const terminalEntryOf = (
    tool: string,
    args: Record<string, any>,
    output: string,
    failed = false
): TerminalEntry | null => {
    const clean = stripAnsi(output);
    const entry = (kind: TerminalEntry['kind'], input: unknown): TerminalEntry => ({
        kind,
        input: clip(String(input ?? ''), MAX_INPUT),
        output: clip(clean, MAX_OUTPUT),
        ...(failed || (kind === 'shell' && exitedWithError(clean)) ? { failed: true } : {})
    });

    switch (tool) {
        case 'sandbox_shell': return entry('shell', args.command);
        case 'sandbox_run_code': return entry(args.language === 'javascript' ? 'javascript' : 'python', args.code);
        case 'sandbox_write_file': return entry('write_file', args.path);
        case 'sandbox_read_file': return entry('read_file', args.path);
        default: return null;
    }
};

/** The sandbox tool and arguments that run a request. */
export const toolCallFor = (request: RunRequest): { tool: string, args: Record<string, string> } =>
    request.kind === 'shell'
        ? { tool: 'sandbox_shell', args: { command: request.input } }
        : { tool: 'sandbox_run_code', args: { language: request.kind, code: request.input } };

/** How much of each output a bot reads: the end, where errors usually are. */
const OUTPUT_FOR_BOTS = 400;

const PROMPT_FOR_BOTS: Record<TerminalEntry['kind'], string> = {
    shell: '$', python: '>>>', javascript: 'js>', write_file: 'write', read_file: 'read'
};

/**
 * A message as bots read it: its text, then what its terminal ran and
 * printed, so "why did that fail?" has something to answer from. A person's
 * `/sh ls` is otherwise just those four characters.
 */
export const textForBots = (message: { content?: string, terminal?: TerminalEntry[] }): string => {
    const text = message.content || '';
    if (!message.terminal?.length) return text;

    const transcript = message.terminal.map(entry => {
        // Stripped here too: messages stored before stripAnsi still carry codes.
        const clean = stripAnsi(entry.output);
        const output = clean.length > OUTPUT_FOR_BOTS ? `…${clean.slice(-OUTPUT_FOR_BOTS)}` : clean;
        return `${PROMPT_FOR_BOTS[entry.kind]} ${entry.input.split('\n').slice(0, 5).join('\n')}${entry.failed ? '  [ошибка]' : ''}\n${output}`;
    });
    return `${text}\n[терминал]\n${transcript.join('\n')}`;
};

/** Keeps the last entries once there are too many. */
export const capEntries = (entries: TerminalEntry[]): TerminalEntry[] =>
    entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;

const FENCE = /^```[^\n`]*\n([\s\S]*?)\n?```\s*$/;

/**
 * `/sh ls -la`, `/py print(2 + 2)` or `/js …` typed in a channel; null for an
 * ordinary message. The code may span lines and may come fenced. An empty
 * command comes back with empty input, so the sender can be told what to type.
 */
export const parseTerminalCommand = (text: string): RunRequest | null => {
    const match = text.trim().match(/^\/(sh|py|js)(?:\s+([\s\S]*))?$/);
    if (!match) return null;

    const body = (match[2] || '').trim();
    const input = (body.match(FENCE)?.[1] ?? body).trim();
    const kind: RunKind = match[1] === 'sh' ? 'shell' : match[1] === 'py' ? 'python' : 'javascript';
    return { kind, input };
};

const LANGUAGES: Record<string, RunKind> = {
    python: 'python', py: 'python', python3: 'python',
    javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript',
    bash: 'shell', sh: 'shell', shell: 'shell', zsh: 'shell', console: 'shell'
};

/**
 * Code blocks of a message that ▶ can run, in order: Python, JavaScript and
 * shell. The fence's first word names the language, as codeSave reads it
 * ("```python app.py"). A `console` block is a transcript: only its "$ "
 * lines are commands.
 */
export const runnableBlocks = (text: string): RunRequest[] => {
    const blocks: RunRequest[] = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text))) {
        const language = match[1].trim().split(/\s+/)[0].toLowerCase();
        const kind = LANGUAGES[language];
        if (!kind) continue;

        const code = match[2].replace(/\s+$/, '');
        const input = language === 'console'
            ? code.split('\n').filter(line => line.startsWith('$ ')).map(line => line.slice(2)).join('\n')
            : code;
        if (input.trim()) blocks.push({ kind, input });
    }

    return blocks;
};
