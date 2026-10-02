/**
 * POST /bots/reply — answers a mention on the server, so the reply is written
 * and signed here (../../services/botSignature) rather than in the caller's
 * browser, where anyone could have written it.
 *
 * With the BOT_REPLIES Workflow bound, the request only starts the reply and
 * returns its run id: the reply is a durable Workflow instance
 * (./agentWorkflow), not tied to the request, and it is posted even if the
 * tab that asked closes. POST /bots/reply/status { runId } tells how it went.
 * Without the binding (or without a refresh token) it runs inline, while the
 * request is open, as before.
 *
 * Either way the bot acts as the caller: Firestore applies the same rules as
 * for the app, and their model key arrives with the request. For a Workflow
 * run it is kept sealed in the instance's parameters, which are retained only
 * briefly. Tool calls that need a yes are asked through an approval document
 * their tab answers; the reply being written is shown through a draft
 * document.
 */

import type { AISettings, BoardMember } from '../../types';
import { answerMentions } from '../../services/runtime/turn';
import { untilAborted } from '../../services/llm';
import { setMcpFetch } from '../../services/mcp';
import { FirestoreRest, TokenSource, restAgentStore } from './firestoreRest';
import { firestoreConfig, fixedToken, decodePayload, sealingSecret, type TaskEnv } from './agentTasks';
import { fileReaders, usageHooksFor, approvalVia, draftWriter } from './runtimeParts';
import { signerFor, verifierFor } from './botKey';
import { BOARD_ID } from './sandbox';
import { seal } from './taskCrypto';

type Json = (body: unknown, status: number) => Response;

/** The longest one mention may take on the server, all bots and tool rounds included. */
export const REPLY_DEADLINE_MS = 4 * 60_000;

/** The Workflow binding, typed structurally so tests need no Cloudflare globals. */
export interface ReplyWorkflowBinding {
    create(options: {
        id?: string;
        params?: ReplyParams;
        retention?: { successRetention?: string; errorRetention?: string };
    }): Promise<{ id: string }>;
    get(id: string): Promise<{ status(): Promise<{ status: string; error?: unknown; output?: unknown }> }>;
}

export interface ReplyEnv extends TaskEnv {
    BOT_REPLIES?: ReplyWorkflowBinding;
}

/** One reply to run: everything but the secrets, which travel sealed. */
export interface ReplyParams {
    uid: string;
    boardId: string;
    channelId: string;
    channelName: string;
    threadId?: string;
    mentions: string[];
    toolPolicy: 'off' | 'auto';
    settings: Pick<AISettings, 'apiBaseUrl' | 'openRouterModel' | 'memoryModel' | 'embeddingModel' | 'fallbackModel' | 'dailyRequestLimit' | 'language'>;
    /** { apiKey, refreshToken, mcpTokens }, sealed. */
    sealed: string;
    selfOrigin: string;
}

export interface ReplySecrets {
    apiKey: string;
    refreshToken?: string;
    mcpTokens?: Record<string, string>;
}

export interface ReplyOutcome { ok: boolean; error?: string }

const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

/** The reply's parameters from a request body; null when it is not one. */
const paramsFrom = (body: any, uid: string, selfOrigin: string): Omit<ReplyParams, 'sealed'> | null => {
    const boardId = str(body.boardId, 128);
    const channelId = str(body.channelId, 128);
    if (!BOARD_ID.test(boardId) || !BOARD_ID.test(channelId)) return null;
    const threadId = str(body.threadId, 128);
    const limit = Number(body.settings?.dailyRequestLimit);
    return {
        uid, boardId, channelId, selfOrigin,
        channelName: str(body.channelName, 100) || 'general',
        threadId: BOARD_ID.test(threadId) ? threadId : undefined,
        mentions: Array.isArray(body.mentions) ? body.mentions.slice(0, 10).map((m: unknown) => str(m, 100)).filter(Boolean) : [],
        toolPolicy: body.toolPolicy === 'off' ? 'off' : 'auto',
        settings: {
            apiBaseUrl: str(body.settings?.apiBaseUrl, 300) || undefined,
            openRouterModel: str(body.settings?.openRouterModel, 200),
            memoryModel: str(body.settings?.memoryModel, 200) || undefined,
            embeddingModel: str(body.settings?.embeddingModel, 200) || undefined,
            fallbackModel: str(body.settings?.fallbackModel, 200) || undefined,
            dailyRequestLimit: Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : undefined,
            language: (str(body.settings?.language, 5) || 'ru') as AISettings['language']
        }
    };
};

/**
 * Writes the bots' replies to one mention. Shared by the inline path and the
 * Workflow step; `tokens` signs in as the caller.
 */
export const runBotReply = async (
    env: TaskEnv,
    params: Omit<ReplyParams, 'sealed'>,
    secrets: ReplySecrets,
    tokens: { get(): Promise<string> },
    selfFetch: (request: Request) => Promise<Response>
): Promise<ReplyOutcome> => {
    const { uid, boardId, channelId, selfOrigin } = params;
    const rest = new FirestoreRest(firestoreConfig(env), tokens as TokenSource);
    // The board is read as the caller: a non-member gets nothing.
    const board = await rest.get(`boards/${boardId}`).catch(() => null);
    if (!board) return { ok: false, error: 'Board not found or not a member' };
    const members = (board.data.members || []) as BoardMember[];

    setMcpFetch((url, init) => url.startsWith(selfOrigin) ? selfFetch(new Request(url, init)) : fetch(url, init));

    const mcpTokens = secrets.mcpTokens || {};
    const store = restAgentStore(rest, {
        toolToken: async url => url.startsWith(selfOrigin) ? tokens.get() : mcpTokens[url],
        // Replies of different people run side by side in one isolate.
        scope: uid,
        ...fileReaders(selfOrigin, selfFetch, () => tokens.get()),
        sign: await signerFor(env),
        isAuthentic: await verifierFor(env)
    });

    const settings: AISettings = {
        ...params.settings,
        openRouterModel: params.settings.openRouterModel || '',
        openRouterKey: secrets.apiKey,
        aiProvider: 'openrouter',
        language: params.settings.language || 'ru',
        userType: 'agent',
        following: []
    } as AISettings;
    settings.usageHooks = usageHooksFor(rest, uid, settings);

    const drafts = draftWriter(rest, boardId, channelId, uid);
    const idOf = (name: string) => members.find(m => m.name === name)?.id || name;
    // However slow the models are, the person hears back in bounded time.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), REPLY_DEADLINE_MS);

    try {
        // Raced as a whole too: a stuck tool call does not take the signal.
        await untilAborted(answerMentions({
            signal: deadline.signal,
            store, mentions: params.mentions, authorId: uid, boardId, channelId,
            channelName: params.channelName,
            threadId: params.threadId,
            members, settings,
            toolPolicy: params.toolPolicy,
            approveTool: approvalVia(rest, boardId, uid),
            confirmDestructive: true,
            onDelta: (botName, text) => drafts.write(idOf(botName), botName, text)
        }), deadline.signal);
    } catch (error) {
        if (!deadline.signal.aborted) throw error;
        // A bot cut off by the deadline leaves a note rather than silence.
        await store.postMessage({
            boardId, channelId, authorId: uid, authorName: 'Potok', authorType: 'human',
            ...(params.threadId ? { threadId: params.threadId } : {}),
            content: `⏱ Модель не успела ответить за ${Math.round(REPLY_DEADLINE_MS / 60000)} мин. Попробуйте ещё раз или выберите в Настройках другую (или запасную) модель.`
        }).catch(() => { });
        return { ok: false, error: 'deadline' };
    } finally {
        clearTimeout(timer);
        await drafts.done();
    }
    return { ok: true };
};

export const handleBotReply = async (
    request: Request,
    env: ReplyEnv,
    uid: string,
    idToken: string,
    selfFetch: (request: Request) => Promise<Response>,
    json: Json
): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    const params = paramsFrom(body, uid, new URL(request.url).origin);
    if (!params) return json({ error: 'boardId and channelId are required' }, 400);
    const apiKey = str(body.apiKey, 500);
    if (!apiKey) return json({ error: 'Model API key is required' }, 400);
    if (!params.mentions.length) return json({ ok: true, answered: 0 }, 200);

    const mcpTokens: Record<string, string> = body.mcpTokens && typeof body.mcpTokens === 'object' ? body.mcpTokens : {};
    const refreshToken = str(body.refreshToken, 4000);

    if (env.BOT_REPLIES && refreshToken && sealingSecret(env)) {
        // The refresh token must be the caller's own: exchange it once and compare.
        const fresh = await new TokenSource(firestoreConfig(env), refreshToken).get();
        const claims = decodePayload(fresh);
        if (claims.user_id !== uid && claims.sub !== uid) {
            return json({ error: 'The refresh token belongs to another account' }, 403);
        }
        // Fail now, not inside the run, when the caller is not on the board.
        const board = await new FirestoreRest(firestoreConfig(env), fixedToken(idToken)).get(`boards/${params.boardId}`).catch(() => null);
        if (!board) return json({ error: 'Board not found or not a member' }, 403);

        // Prefixed with the uid, so only its owner can ask how it went.
        const runId = `${uid}-${crypto.randomUUID()}`;
        await env.BOT_REPLIES.create({
            id: runId,
            params: {
                ...params,
                sealed: await seal({ apiKey, refreshToken, mcpTokens } satisfies ReplySecrets, sealingSecret(env))
            },
            // Kept briefly: the instance stores its parameters, sealed secrets included.
            retention: { successRetention: '1 hour', errorRetention: '1 day' }
        });
        return json({ runId }, 202);
    }

    const outcome = await runBotReply(env, params, { apiKey, mcpTokens }, fixedToken(idToken), selfFetch);
    if (!outcome.ok && outcome.error !== 'deadline') return json({ error: outcome.error }, 403);
    return json(outcome, 200);
};

/** POST /bots/reply/status { runId } → { state: 'running' | 'done' | 'failed', error? } */
export const handleBotReplyStatus = async (request: Request, env: ReplyEnv, uid: string, json: Json): Promise<Response> => {
    if (!env.BOT_REPLIES) return json({ error: 'Replies run inline on this worker' }, 501);
    const body: any = await request.json().catch(() => ({}));
    const runId = str(body.runId, 200);
    if (!runId.startsWith(`${uid}-`)) return json({ error: 'Not your reply' }, 403);

    const instance = await env.BOT_REPLIES.get(runId).catch(() => null);
    if (!instance) return json({ state: 'failed', error: 'Reply not found' }, 200);
    const { status, error, output } = await instance.status();
    if (status === 'complete') {
        const result = (output || {}) as ReplyOutcome;
        return json({ state: 'done', ...(result.ok === false ? { error: result.error } : {}) }, 200);
    }
    if (status === 'errored' || status === 'terminated') {
        const message = typeof error === 'string' ? error : (error as any)?.message || status;
        return json({ state: 'failed', error: String(message).slice(0, 300) }, 200);
    }
    return json({ state: 'running' }, 200);
};
