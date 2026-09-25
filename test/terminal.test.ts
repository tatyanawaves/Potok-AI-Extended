import { describe, it, expect } from 'vitest';
import {
    terminalEntryOf, parseTerminalCommand, runnableBlocks, toolCallFor, capEntries, stripAnsi, textForBots,
    MAX_OUTPUT, MAX_ENTRIES
} from '../services/terminal';
import { selectWindow } from '../services/memoryCore';

describe('terminalEntryOf', () => {
    it('shows a shell command and its output', () => {
        expect(terminalEntryOf('sandbox_shell', { command: 'ls' }, 'exit 0\na.txt'))
            .toEqual({ kind: 'shell', input: 'ls', output: 'exit 0\na.txt' });
    });

    it('marks a command that exited with an error', () => {
        expect(terminalEntryOf('sandbox_shell', { command: 'false' }, 'exit 1\n')?.failed).toBe(true);
        expect(terminalEntryOf('sandbox_shell', { command: 'true' }, 'exit 0\n')?.failed).toBeUndefined();
    });

    it('keeps the language of code, Python by default', () => {
        expect(terminalEntryOf('sandbox_run_code', { language: 'javascript', code: '1+1' }, '2')?.kind).toBe('javascript');
        expect(terminalEntryOf('sandbox_run_code', { code: 'print(1)' }, '1')?.kind).toBe('python');
    });

    it('shows file operations by their path', () => {
        expect(terminalEntryOf('sandbox_write_file', { path: 'app.py', content: 'x' }, 'Saved app.py'))
            .toMatchObject({ kind: 'write_file', input: 'app.py' });
        expect(terminalEntryOf('sandbox_read_file', { path: 'app.py' }, 'x'))
            .toMatchObject({ kind: 'read_file', input: 'app.py' });
    });

    it('records a failed call as failed', () => {
        expect(terminalEntryOf('sandbox_run_code', { code: 'x' }, 'Error: no key', true)?.failed).toBe(true);
    });

    it('ignores every other tool', () => {
        expect(terminalEntryOf('get_time', {}, 'now')).toBeNull();
        expect(terminalEntryOf('memory_remember', { fact: 'x' }, 'Saved')).toBeNull();
    });

    it('cuts long output, saying so', () => {
        const output = terminalEntryOf('sandbox_shell', { command: 'yes' }, 'y\n'.repeat(MAX_OUTPUT))!.output;
        expect(output.length).toBeLessThan(MAX_OUTPUT + 20);
        expect(output.endsWith('(обрезано)')).toBe(true);
    });
});

describe('parseTerminalCommand', () => {
    it('reads /sh, /py and /js', () => {
        expect(parseTerminalCommand('/sh ls -la')).toEqual({ kind: 'shell', input: 'ls -la' });
        expect(parseTerminalCommand('/py print(2 + 2)')).toEqual({ kind: 'python', input: 'print(2 + 2)' });
        expect(parseTerminalCommand('/js console.log(1)')).toEqual({ kind: 'javascript', input: 'console.log(1)' });
    });

    it('takes code over several lines, fenced or not', () => {
        expect(parseTerminalCommand('/py\nx = 2\nprint(x * 3)')).toEqual({ kind: 'python', input: 'x = 2\nprint(x * 3)' });
        expect(parseTerminalCommand('/py ```python\nprint(1)\n```')).toEqual({ kind: 'python', input: 'print(1)' });
    });

    it('returns an empty command, so the sender can be told what to type', () => {
        expect(parseTerminalCommand('/sh')).toEqual({ kind: 'shell', input: '' });
    });

    it('leaves ordinary messages alone', () => {
        expect(parseTerminalCommand('@Бот запусти /sh ls')).toBeNull();
        expect(parseTerminalCommand('/shrug')).toBeNull();
        expect(parseTerminalCommand('привет')).toBeNull();
    });
});

describe('runnableBlocks', () => {
    it('finds Python, JavaScript and shell blocks in order', () => {
        const text = 'Вот:\n```bash\npip install requests\n```\nи\n```python app.py\nprint("hi")\n```\n```js\nconsole.log(1)\n```';
        expect(runnableBlocks(text)).toEqual([
            { kind: 'shell', input: 'pip install requests' },
            { kind: 'python', input: 'print("hi")' },
            { kind: 'javascript', input: 'console.log(1)' }
        ]);
    });

    it('skips languages it cannot run, and empty blocks', () => {
        expect(runnableBlocks('```ts\nconst a = 1\n```\n```\nplain\n```\n```python\n\n```')).toEqual([]);
    });

    it('runs only the commands of a console transcript', () => {
        expect(runnableBlocks('```console\n$ echo hi\nhi\n$ pwd\n/home\n```'))
            .toEqual([{ kind: 'shell', input: 'echo hi\npwd' }]);
    });
});

describe('toolCallFor', () => {
    it('sends shell to sandbox_shell and code to sandbox_run_code', () => {
        expect(toolCallFor({ kind: 'shell', input: 'ls' })).toEqual({ tool: 'sandbox_shell', args: { command: 'ls' } });
        expect(toolCallFor({ kind: 'python', input: 'print(1)' }))
            .toEqual({ tool: 'sandbox_run_code', args: { language: 'python', code: 'print(1)' } });
    });
});

describe('stripAnsi', () => {
    it('drops the colour codes pip prints, keeping the text', () => {
        // Seen in a real E2B sandbox: pip colours its warnings even without a terminal.
        const raw = '\u001b[33mWARNING: Running pip as root\u001b[0m\n\u001b[1m[\u001b[0m\u001b[34;49mnotice\u001b[0m\u001b[1m]\u001b[0m new pip';
        expect(stripAnsi(raw)).toBe('WARNING: Running pip as root\n[notice] new pip');
    });

    it('is applied to what a sandbox call stores', () => {
        expect(terminalEntryOf('sandbox_shell', { command: 'pip' }, 'exit 0\n\u001b[31mred\u001b[0m')?.output).toBe('exit 0\nred');
    });
});

describe('textForBots', () => {
    it('is the text alone when nothing ran', () => {
        expect(textForBots({ content: 'привет' })).toBe('привет');
    });

    it('adds what ran and what it printed, marking failures', () => {
        const text = textForBots({
            content: '/sh ls /nope',
            terminal: [{ kind: 'shell', input: 'ls /nope', output: 'exit 2\nls: cannot access', failed: true }]
        });
        expect(text).toBe('/sh ls /nope\n[терминал]\n$ ls /nope  [ошибка]\nexit 2\nls: cannot access');
    });

    it('strips colour codes from outputs stored before they were stripped on write', () => {
        const text = textForBots({ content: '▶', terminal: [{ kind: 'shell', input: 'pip', output: '\u001b[33mWARNING\u001b[0m' }] });
        expect(text).not.toContain('\u001b');
        expect(text).toContain('WARNING');
    });

    it('keeps the end of a long output, where the error usually is', () => {
        const text = textForBots({
            content: '▶',
            terminal: [{ kind: 'python', input: 'run()', output: `${'x'.repeat(2000)}Traceback: boom` }]
        });
        expect(text.endsWith('Traceback: boom')).toBe(true);
        expect(text.length).toBeLessThan(500);
    });
});

describe('the bot window', () => {
    it('shows bots the terminal of a message, not just its command', () => {
        const window = selectWindow([{
            id: 'm', channelId: 'c', boardId: 'b', authorId: 'u', authorName: 'Tester_A', authorType: 'human',
            content: '/sh python3 app.py', mentions: [], timestamp: 1,
            terminal: [{ kind: 'shell', input: 'python3 app.py', output: 'exit 1\nModuleNotFoundError: requests', failed: true }]
        }]);
        expect(window[0].content).toContain('ModuleNotFoundError: requests');
    });
});

describe('capEntries', () => {
    it('keeps the last entries, which hold the outcome', () => {
        const entries = Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => ({ kind: 'shell' as const, input: `c${i}`, output: '' }));
        const kept = capEntries(entries);
        expect(kept).toHaveLength(MAX_ENTRIES);
        expect(kept.at(-1)?.input).toBe(`c${MAX_ENTRIES + 2}`);
    });
});
