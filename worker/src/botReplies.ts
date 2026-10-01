/**
 * POST /bots/reply — answers a mention on the server, so the reply is written
 * and signed here (../../services/botSignature) rather than in the caller's
 * browser, where anyone could have written it.
 *
 * Runs while the request is open, with the caller's own ID token: Firestore
 * applies the same rules as for the app, the bot acts on the caller's
 * accounts as before, and their model key arrives with the request and is
 * not kept. Tool calls that need a yes are asked through an approval
 * document their tab answers; the reply being written is shown through a
 * draft document.
 */

import type { AISettings, BoardMember } from '../../types';
import { answerMentions } from '../../services/runtime/turn';
import { setMcpFetch } from '../../services/mcp';
import { FirestoreRest, restAgentStore } from './firestoreRest';
import { firestoreConfig, fixedToken, type TaskEnv } from './agentTasks';
import { fileReaders, usageHooksFor, approvalVia, draftWriter } from './runtimeParts';
import { signerFor, verifierFor } from './botKey';
import { BOARD_ID } from './sandbox';

type Json = (body: unknown, status: number) => Response;

const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

export const handleBotReply = async (
    request: Request,
    env: TaskEnv,
    uid: string,
    idToken: string,
    selfFetch: (request: Request) => Promise<Response>,
    json: Json
): Promise<Response> => {
    const body: any = await request.json().catch(() => ({}));
    const boardId = str(body.boardId, 128);
    const channelId = str(body.channelId, 128);
    const apiKey = str(body.apiKey, 500);
    const mentions: string[] = Array.isArray(body.mentions) ? body.mentions.slice(0, 10).map((m: unknown) => str(m, 100)) : [];
    if (!BOARD_ID.test(boardId) || !BOARD_ID.test(channelId)) return json({ error: 'boardId and channelId are required' }, 400);
    if (!apiKey) return json({ error: 'Model API key is required' }, 400);
    if (!mentions.length) return json({ ok: true, answered: 0 }, 200);

    const rest = new FirestoreRest(firestoreConfig(env), fixedToken(idToken));
    // The board is read with the caller's token: a non-member gets nothing.
    const board = await rest.get(`boards/${boardId}`).catch(() => null);
    if (!board) return json({ error: 'Board not found or not a member' }, 403);
    const members = (board.data.members || []) as BoardMember[];

    const selfOrigin = new URL(request.url).origin;
    setMcpFetch((url, init) => url.startsWith(selfOrigin) ? selfFetch(new Request(url, init)) : fetch(url, init));

    const mcpTokens: Record<string, string> = body.mcpTokens && typeof body.mcpTokens === 'object' ? body.mcpTokens : {};
    const store = restAgentStore(rest, {
        toolToken: async url => url.startsWith(selfOrigin) ? idToken : mcpTokens[url],
        scope: uid,
        ...fileReaders(selfOrigin, selfFetch, async () => idToken),
        sign: await signerFor(env),
        isAuthentic: await verifierFor(env)
    });

    const settings: AISettings = {
        apiBaseUrl: str(body.settings?.apiBaseUrl, 300) || undefined,
        openRouterModel: str(body.settings?.openRouterModel, 200),
        memoryModel: str(body.settings?.memoryModel, 200) || undefined,
        embeddingModel: str(body.settings?.embeddingModel, 200) || undefined,
        fallbackModel: str(body.settings?.fallbackModel, 200) || undefined,
        dailyRequestLimit: Number.isFinite(Number(body.settings?.dailyRequestLimit)) ? Math.max(0, Math.floor(Number(body.settings.dailyRequestLimit))) : undefined,
        openRouterKey: apiKey,
        aiProvider: 'openrouter',
        language: (str(body.settings?.language, 5) || 'ru') as AISettings['language'],
        userType: 'agent',
        following: []
    } as AISettings;
    settings.usageHooks = usageHooksFor(rest, uid, settings);

    const drafts = draftWriter(rest, boardId, channelId, uid);
    const idOf = (name: string) => members.find(m => m.name === name)?.id || name;

    try {
        await answerMentions({
            store, mentions, authorId: uid, boardId, channelId,
            channelName: str(body.channelName, 100) || 'general',
            members, settings,
            toolPolicy: body.toolPolicy === 'off' ? 'off' : 'auto',
            approveTool: approvalVia(rest, boardId, uid),
            confirmDestructive: true,
            onDelta: (botName, text) => drafts.write(idOf(botName), botName, text)
        });
    } finally {
        await drafts.done();
    }
    return json({ ok: true }, 200);
};
