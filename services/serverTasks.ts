import { collection, onSnapshot, orderBy, limit, query } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AISettings } from '../types';

/**
 * Server tasks: an orchestrated meeting run by the worker (worker/src/
 * agentTasks.ts) instead of this tab. It keeps going when the tab closes, and
 * every member of the board sees its progress live.
 *
 * To act for the user, the worker needs their model key and a way to stay
 * signed in as them for longer than an hour — their Firebase refresh token.
 * Both are sent once, over HTTPS, and stored only sealed, for the life of the
 * task. The person is told this before starting one.
 */

const TASKS_URL: string = (import.meta.env.VITE_TASKS_WORKER_URL || import.meta.env.VITE_PIPEDREAM_WORKER_URL || '')
    .replace(/\/$/, '');

export const serverTasksAvailable = (): boolean => Boolean(TASKS_URL);

export interface ServerTask {
    id: string;
    status: 'queued' | 'running' | 'done' | 'stopped' | 'failed';
    phase: 'planning' | 'working' | 'checking' | 'waiting' | 'finishing' | 'done';
    /** While paused on a slow job: when it wakes up. */
    waitUntil?: number;
    task: string;
    channelId: string;
    startedBy: string;
    startedByName: string;
    bots: string[];
    bot?: string;
    progress: number;
    step: number;
    totalSteps: number;
    result?: string;
    error?: string;
    cancelRequested?: boolean;
    createdAt: number;
    updatedAt: number;
}

export const isActive = (task: ServerTask) => task.status === 'queued' || task.status === 'running';

/** A task that has said nothing for this long is probably gone. */
export const STALE_AFTER_MS = 20 * 60_000;

export const subscribeToTasks = (boardId: string, callback: (tasks: ServerTask[]) => void) =>
    onSnapshot(
        query(collection(db, 'boards', boardId, 'tasks'), orderBy('createdAt', 'desc'), limit(10)),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ServerTask)),
        () => callback([])
    );

const post = async (path: string, body: unknown): Promise<any> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const response = await fetch(`${TASKS_URL}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Сервер ответил ${response.status}`);
    return data;
};

export interface StartTaskOptions {
    boardId: string;
    channelId: string;
    channelName: string;
    task: string;
    maxSteps: number;
    botIds: string[];
    toolPolicy: 'off' | 'auto';
    settings: AISettings;
}

export const startServerTask = async (options: StartTaskOptions): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const { settings } = options;
    if (!settings.openRouterKey || settings.openRouterKey === 'google-auth') {
        throw new Error('Нужен ключ API в настройках — задача пойдёт на нём');
    }

    const { taskId } = await post('/tasks/start', {
        boardId: options.boardId,
        channelId: options.channelId,
        channelName: options.channelName,
        task: options.task,
        maxSteps: options.maxSteps,
        botIds: options.botIds,
        toolPolicy: options.toolPolicy,
        authorName: settings.agentName || 'User',
        settings: {
            apiBaseUrl: settings.apiBaseUrl || undefined,
            openRouterModel: settings.openRouterModel || undefined,
            memoryModel: settings.memoryModel || undefined,
            embeddingModel: settings.embeddingModel || undefined
        },
        apiKey: settings.openRouterKey,
        refreshToken: user.refreshToken,
        mcpTokens: settings.mcpTokens || {}
    });
    return taskId;
};

export const cancelServerTask = (boardId: string, taskId: string): Promise<void> =>
    post('/tasks/cancel', { boardId, taskId });

/** Tool servers on this machine are out of the worker's reach. */
export const isLocalUrl = (url: string): boolean => {
    try {
        const host = new URL(url).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
    } catch {
        return false;
    }
};
