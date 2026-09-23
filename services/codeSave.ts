/**
 * Saving code that bots write: pulling files out of a message, then writing
 * them to a folder on this computer, a download, the board's cloud storage or
 * a GitHub repository.
 */

export interface CodeFile {
    path: string;
    content: string;
}

const EXTENSIONS: Record<string, string> = {
    js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'jsx',
    py: 'py', python: 'py', sh: 'sh', bash: 'sh', shell: 'sh', json: 'json', yaml: 'yml', yml: 'yml',
    html: 'html', css: 'css', sql: 'sql', md: 'md', markdown: 'md', go: 'go', rust: 'rs', rs: 'rs',
    java: 'java', kotlin: 'kt', kt: 'kt', swift: 'swift', c: 'c', cpp: 'cpp', 'c++': 'cpp', cs: 'cs',
    csharp: 'cs', php: 'php', ruby: 'rb', rb: 'rb', dockerfile: 'Dockerfile', toml: 'toml', xml: 'xml'
};

/** A relative path that cannot climb out of the chosen folder. */
export const safePath = (raw: string): string =>
    raw.replace(/\\/g, '/').split('/')
        .map(part => part.trim().replace(/[<>:"|?*\u0000-\u001f]/g, ''))
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');

/**
 * Code blocks of a message as files. A name is taken, in order, from the fence
 * info ("```ts src/app.ts"), from a first-line comment ("// file: app.ts",
 * "# app.py"), else made up from the language.
 */
export const extractCodeFiles = (text: string): CodeFile[] => {
    const files: CodeFile[] = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let n = 0;

    while ((match = re.exec(text))) {
        n++;
        const [lang = '', ...rest] = match[1].trim().split(/\s+/);
        let content = match[2].replace(/\n$/, '');
        let name = rest.join(' ');

        const firstLine = content.split('\n')[0];
        const named = firstLine.match(/^\s*(?:\/\/|#|--|<!--|\/\*)\s*(?:file(?:name)?:\s*)?([\w./-]+\.\w+)\s*(?:-->|\*\/)?\s*$/i);
        if (!name && named) {
            name = named[1];
            content = content.split('\n').slice(1).join('\n');
        }

        const ext = EXTENSIONS[lang.toLowerCase()] || (lang ? lang.toLowerCase() : 'txt');
        const path = safePath(name) || (ext === 'Dockerfile' ? 'Dockerfile' : `snippet-${n}.${ext}`);
        files.push({ path, content: `${content}\n` });
    }
    return files;
};

/** Whether the browser can open a folder picker (Chrome, Edge; not Firefox or Safari). */
export const folderPickerAvailable = (): boolean =>
    typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Asks for a folder through the system file dialog and writes the files into it. */
export const saveToFolder = async (files: CodeFile[]): Promise<string> => {
    const root: any = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    for (const file of files) {
        const parts = safePath(file.path).split('/');
        let dir = root;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await handle.createWritable();
        await writable.write(file.content);
        await writable.close();
    }
    return root.name as string;
};

export const downloadFiles = (files: CodeFile[]): void => {
    for (const file of files) {
        const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = file.path.split('/').pop() || 'file.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
};

export const toFile = (file: CodeFile): File =>
    new File([file.content], file.path.split('/').pop() || 'file.txt', { type: 'text/plain' });

const utf8ToBase64 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
};

export interface GitHubTarget {
    repo: string;      // owner/name
    branch: string;
    folder: string;
    message: string;
}

/**
 * Commits the files through the GitHub contents API with the user's own token
 * (a fine-grained token with Contents: read and write is enough). One commit
 * per file; an existing file is updated in place.
 */
export const saveToGitHub = async (files: CodeFile[], target: GitHubTarget, token: string): Promise<string> => {
    const repo = target.repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Репозиторий в виде owner/name');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const branch = target.branch.trim() || 'main';

    for (const file of files) {
        const path = [safePath(target.folder), safePath(file.path)].filter(Boolean).join('/');
        const url = `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

        const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
        const sha = existing.ok ? (await existing.json()).sha : undefined;

        const response = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                message: target.message.trim() || `Add ${path} from Potok`,
                content: utf8ToBase64(file.content),
                branch,
                ...(sha ? { sha } : {})
            })
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(`${path}: ${body.message || response.status}`);
        }
    }
    return `https://github.com/${repo}/tree/${encodeURIComponent(branch)}/${safePath(target.folder)}`;
};
