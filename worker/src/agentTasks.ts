/**
 * Server tasks: an orchestrated meeting that runs in this worker instead of a
 * browser tab, so it goes on when the tab closes and survives restarts.
 *
 *   POST /tasks/start   { boardId, channelId, channelName, task, maxSteps,
 *                         botIds, toolPolicy, settings, apiKey, refreshToken }
 *   POST /tasks/cancel  { boardId, taskId }
 *
 * The run is a Cloudflare Workflow (./agentWorkflow): every wave of steps is a
 * durable step, so a restart resumes where it stopped instead of starting over.
 * Progress is written to boards/{boardId}/tasks/{taskId}, which the board
 * shows live to every member.
 *
 * The task acts as the person who started it — their model key, their
 * Firestore permissions — and nothing else. Their secrets travel sealed.
 */

import type { AISettings, BoardMember } from '../../types';
import { isBot } from '../../services/mentions';
import { setMcpFetch } from '../../services/mcp';
import { MAX_ORCHESTRATED_STEPS } from '../../services/orchestratorCore';
import type { TaskContext } from '../../services/runtime/orchestrate';
import { FirestoreRest, TokenSource, restAgentStore, type FirestoreConfig } from './firestoreRest';
import { seal, open } from './taskCrypto';

/** The Workflow binding, typed structurally so tests need no Cloudflare globals. */
export interface TaskWorkflowBinding {
    create(options: {
        id?: string;
        params?: TaskParams;
        retention?: { successRetention?: string; errorRetention?: string };
    }): Promise<{ id: string }>;
}

export interface TaskEnv {
    FIREBASE_PROJECT_ID: string;
    FIREBASE_WEB_API_KEY?: string;
    /** Key material for sealing task secrets; falls back to the Pipedream secret. */
    TASK_SEALING_SECRET?: string;
    PIPEDREAM_CLIENT_SECRET?: string;
    /** Local development against the Firebase emulators only. */
    AUTH_EMULATOR_HOST?: string;
    FIRESTORE_EMULATOR_HOST?: string;
    AGENT_TASKS?: TaskWorkflowBinding;
}

export interface TaskParams {
    taskId: string;
    boardId: string;
    channelId: string;
    channelName: string;
    task: string;
    maxSteps: number;
    toolPolicy: 'off' | 'auto';
    bots: BoardMember[];
    author: { id: string, name: string };
    /** Non-secret model settings. */
    settings: Pick<AISettings, 'apiBaseUrl' | 'openRouterModel' | 'memoryModel' | 'embeddingModel'>;
    /** { apiKey, refreshToken, mcpTokens }, sealed. */
    sealed: string;
    /** This worker's public origin, to reach its own Pipedream bridge in-process. */
    selfOrigin: string;
}

interface Secrets {
    apiKey: string;
    refreshToken: string;
    mcpTokens?: Record<string, string>;
}

export const taskPath = (boardId: string, taskId: string) => `boards/${boardId}/tasks/${taskId}`;

const sealingSecret = (env: TaskEnv) => env.TASK_SEALING_SECRET || env.PIPEDREAM_CLIENT_SECRET || '';

export const firestoreConfig = (env: TaskEnv): FirestoreConfig => {
    if (!env.FIREBASE_WEB_API_KEY) throw new Error('Server tasks are not configured: FIREBASE_WEB_API_KEY');
    return {
        projectId: env.FIREBASE_PROJECT_ID,
        apiKey: env.FIREBASE_WEB_API_KEY,
        firestoreEmulatorHost: env.FIRESTORE_EMULATOR_HOST || undefined,
        authEmulatorHost: env.AUTH_EMULATOR_HOST || undefined
    };
};

/** A token source that is just the caller's current ID token. */
const fixedToken = (idToken: string) => ({ get: async () => idToken }) as unknown as TokenSource;

const decodePayload = (jwt: string): any => {
    try {
        const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
    } catch {
        return {};
    }
};

export interface OpenRuntime {
    ctx: TaskContext;
    rest: FirestoreRest;
    cancelRequested(): Promise<boolean>;
    setTask(fields: Record<string, unknown>): Promise<void>;
}

/**
 * Opens a task's secrets and builds the runtime it runs with. `selfFetch`
 * serves requests to this worker's own address in-process.
 */
export const openRuntime = async (
    env: TaskEnv,
    params: TaskParams,
    selfFetch: (request: Request) => Promise<Response>
): Promise<OpenRuntime> => {
    const secrets = await open<Secrets>(params.sealed, sealingSecret(env));
    const tokens = new TokenSource(firestoreConfig(env), secrets.refreshToken);
    const rest = new FirestoreRest(firestoreConfig(env), tokens);

    setMcpFetch((url, init) => url.startsWith(params.selfOrigin)
        ? selfFetch(new Request(url, init))
        : fetch(url, init));

    const store = restAgentStore(rest, {
        // The Pipedream bridge takes the user's ID token; other servers the
        // token the user saved for them.
        toolToken: async url => url.startsWith(params.selfOrigin) ? tokens.get() : secrets.mcpTokens?.[url]
    });

    const settings: AISettings = {
        ...params.settings,
        openRouterKey: secrets.apiKey,
        openRouterModel: params.settings.openRouterModel || '',
        aiProvider: 'openrouter',
        language: 'ru',
        userType: 'agent',
        following: []
    };

    const path = taskPath(params.boardId, params.taskId);
    return {
        rest,
        ctx: {
            store, settings,
            boardId: params.boardId,
            channelId: params.channelId,
            channelName: params.channelName,
            bots: params.bots,
            task: params.task,
            maxSteps: params.maxSteps,
            author: params.author,
            toolPolicy: params.toolPolicy
        },
        cancelRequested: async () => Boolean((await rest.get(path))?.data.cancelRequested),
        setTask: async fields => {
            await rest.update(path, { ...fields, updatedAt: Date.now() }).catch(error => {
                console.error('[tasks] progress write failed', error);
            });
        }
    };
};

type Json = (body: unknown, status: number) => Response;

export const handleTaskStart = async (
    request: Request, env: TaskEnv, uid: string, idToken: string, json: Json
): Promise<Response> => {
    if (!env.AGENT_TASKS) return json({ error: 'Server tasks are not enabled on this worker' }, 501);
    if (!sealingSecret(env)) return json({ error: 'Server tasks are not configured: no sealing secret' }, 501);

    const body: any = await request.json().catch(() => ({}));
    const { boardId, channelId, channelName, task, botIds, apiKey, refreshToken } = body;
    if (![boardId, channelId, task, apiKey, refreshToken].every(v => typeof v === 'string' && v.trim())) {
        return json({ error: 'boardId, channelId, task, apiKey and refreshToken are required' }, 400);
    }

    // The refresh token must be the caller's own: exchange it once and compare.
    const tokens = new TokenSource(firestoreConfig(env), refreshToken);
    const fresh = await tokens.get();
    if (decodePayload(fresh).user_id !== uid && decodePayload(fresh).sub !== uid) {
        return json({ error: 'The refresh token belongs to another account' }, 403);
    }

    // Read as the caller: the board's rules answer "is this person a member".
    const asCaller = new FirestoreRest(firestoreConfig(env), fixedToken(idToken));
    const board = await asCaller.get(`boards/${boardId}`).catch(() => null);
    if (!board) return json({ error: 'Board not found or you are not a member' }, 403);

    const members: BoardMember[] = board.data.members || [];
    const bots = members.filter(m => isBot(m) && (!Array.isArray(botIds) || botIds.includes(m.id)));
    if (bots.length === 0) return json({ error: 'No bots selected' }, 400);

    const taskId = crypto.randomUUID();
    const maxSteps = Math.min(Math.max(Number(body.maxSteps) || 4, 1), MAX_ORCHESTRATED_STEPS);
    const toolPolicy = body.toolPolicy === 'off' ? 'off' : 'auto';
    const authorName = String(body.authorName || 'User').slice(0, 60);
    const now = Date.now();

    await asCaller.create(`boards/${boardId}/tasks`, {
        status: 'queued',
        phase: 'planning',
        task: String(task).slice(0, 2000),
        channelId,
        startedBy: uid,
        startedByName: authorName,
        bots: bots.map(b => b.name),
        progress: 0,
        step: 0,
        totalSteps: maxSteps,
        createdAt: now,
        updatedAt: now
    }, taskId);

    const params: TaskParams = {
        taskId, boardId, channelId,
        channelName: String(channelName || 'general'),
        task: String(task).slice(0, 2000),
        maxSteps, toolPolicy, bots,
        author: { id: uid, name: authorName },
        settings: {
            apiBaseUrl: body.settings?.apiBaseUrl || undefined,
            openRouterModel: body.settings?.openRouterModel || undefined,
            memoryModel: body.settings?.memoryModel || undefined,
            embeddingModel: body.settings?.embeddingModel || undefined
        },
        sealed: await seal({ apiKey, refreshToken, mcpTokens: body.mcpTokens || {} } satisfies Secrets, sealingSecret(env)),
        selfOrigin: new URL(request.url).origin
    };

    // Kept briefly: the instance stores its parameters, sealed secrets included.
    await env.AGENT_TASKS.create({
        id: taskId,
        params,
        retention: { successRetention: '1 day', errorRetention: '3 days' }
    });

    return json({ taskId }, 200);
};

/**
 * Asks a task to stop. It finishes the wave in progress, then posts its
 * report marked as stopped — cutting a bot off mid-answer would lose the work
 * already paid for.
 */
export const handleTaskCancel = async (
    request: Request, env: TaskEnv, _uid: string, idToken: string, json: Json
): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    if (typeof body.boardId !== 'string' || typeof body.taskId !== 'string') {
        return json({ error: 'boardId and taskId are required' }, 400);
    }
    const asCaller = new FirestoreRest(firestoreConfig(env), fixedToken(idToken));
    await asCaller.update(taskPath(body.boardId, body.taskId), { cancelRequested: true });
    return json({ ok: true }, 200);
};
