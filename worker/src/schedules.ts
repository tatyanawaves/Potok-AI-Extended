/**
 * Scheduled bot requests: "every weekday at 9:00, @bot do this".
 *
 * The schedule itself is a document, boards/{boardId}/schedules/{id}, which
 * every member sees and its creator edits (firestore.rules). What the server
 * needs to act for the creator later — their model key and refresh token —
 * is kept here, sealed, in KV under sched:{boardId}:{id}:
 *
 *   POST /schedules/save    { boardId, scheduleId, apiKey, refreshToken, mcpTokens, settings }
 *   POST /schedules/delete  { boardId, scheduleId }
 *
 * A cron tick (every STEP_MINUTES) walks those records, reads each schedule
 * as its creator and, when it is due, posts the request in the channel in
 * their name and starts the bot's reply as a durable Workflow
 * (./botReplies). A schedule whose document is gone, or that its creator can
 * no longer read (they left the board), is forgotten.
 */

import type { AISettings } from '../../types';
import { isDue, ranRecently, type Schedule } from '../../services/schedule';
import { FirestoreRest, TokenSource } from './firestoreRest';
import { firestoreConfig, fixedToken, decodePayload, sealingSecret } from './agentTasks';
import type { ReplyEnv, ReplyParams, ReplySecrets } from './botReplies';
import { BOARD_ID } from './sandbox';
import { seal, open } from './taskCrypto';

export interface ScheduleKv {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(options: { prefix: string, cursor?: string }): Promise<{ keys: Array<{ name: string }>, list_complete: boolean, cursor?: string }>;
}

export interface ScheduleEnv extends ReplyEnv {
    /** Shared with the OAuth connectors; schedule records live under sched:. */
    CONNECTOR_TOKENS?: ScheduleKv | any;
}

interface ScheduleRecord {
    uid: string;
    boardId: string;
    scheduleId: string;
    /** ReplySecrets, sealed. */
    sealed: string;
    selfOrigin: string;
    settings: ReplyParams['settings'];
}

type Json = (body: unknown, status: number) => Response;

const keyOf = (boardId: string, scheduleId: string) => `sched:${boardId}:${scheduleId}`;
const pathOf = (boardId: string, scheduleId: string) => `boards/${boardId}/schedules/${scheduleId}`;
const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

const enabled = (env: ScheduleEnv) => Boolean(env.CONNECTOR_TOKENS && env.BOT_REPLIES && sealingSecret(env));

export const handleScheduleSave = async (request: Request, env: ScheduleEnv, uid: string, idToken: string, json: Json): Promise<Response> => {
    if (!enabled(env)) return json({ error: 'Schedules are not enabled on this worker' }, 501);
    const body: any = await request.json().catch(() => ({}));
    const boardId = str(body.boardId, 128);
    const scheduleId = str(body.scheduleId, 128);
    const apiKey = str(body.apiKey, 500);
    const refreshToken = str(body.refreshToken, 4000);
    if (!BOARD_ID.test(boardId) || !BOARD_ID.test(scheduleId)) return json({ error: 'boardId and scheduleId are required' }, 400);
    if (!apiKey || !refreshToken) return json({ error: 'apiKey and refreshToken are required' }, 400);

    // Only the schedule's creator can arm it, with their own sign-in.
    const doc = await new FirestoreRest(firestoreConfig(env), fixedToken(idToken)).get(pathOf(boardId, scheduleId)).catch(() => null);
    if (!doc || doc.data.createdBy !== uid) return json({ error: 'Schedule not found or not yours' }, 403);
    const claims = decodePayload(await new TokenSource(firestoreConfig(env), refreshToken).get());
    if (claims.user_id !== uid && claims.sub !== uid) return json({ error: 'The refresh token belongs to another account' }, 403);

    const limit = Number(body.settings?.dailyRequestLimit);
    const record: ScheduleRecord = {
        uid, boardId, scheduleId,
        selfOrigin: new URL(request.url).origin,
        sealed: await seal({
            apiKey, refreshToken,
            mcpTokens: body.mcpTokens && typeof body.mcpTokens === 'object' ? body.mcpTokens : {}
        } satisfies ReplySecrets, sealingSecret(env)),
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
    await (env.CONNECTOR_TOKENS as ScheduleKv).put(keyOf(boardId, scheduleId), JSON.stringify(record));
    return json({ ok: true }, 200);
};

export const handleScheduleDelete = async (request: Request, env: ScheduleEnv, uid: string, json: Json): Promise<Response> => {
    if (!env.CONNECTOR_TOKENS) return json({ ok: true }, 200);
    const body: any = await request.json().catch(() => ({}));
    const boardId = str(body.boardId, 128);
    const scheduleId = str(body.scheduleId, 128);
    if (!BOARD_ID.test(boardId) || !BOARD_ID.test(scheduleId)) return json({ error: 'boardId and scheduleId are required' }, 400);
    const kv = env.CONNECTOR_TOKENS as ScheduleKv;
    const raw = await kv.get(keyOf(boardId, scheduleId));
    // Someone else's record is left for the next tick, which drops it once its document is gone.
    if (raw && (JSON.parse(raw) as ScheduleRecord).uid === uid) await kv.delete(keyOf(boardId, scheduleId));
    return json({ ok: true }, 200);
};

/** Runs every schedule due at `at`. Returns how many were started. */
export const runDueSchedules = async (env: ScheduleEnv, at: number): Promise<number> => {
    if (!enabled(env)) return 0;
    const kv = env.CONNECTOR_TOKENS as ScheduleKv;
    let started = 0;
    let cursor: string | undefined;
    do {
        const page = await kv.list({ prefix: 'sched:', cursor });
        cursor = page.list_complete ? undefined : page.cursor;
        for (const { name } of page.keys) {
            try {
                if (await runOne(env, kv, name, at)) started++;
            } catch (error) {
                console.error('[schedules]', name, error);
            }
        }
    } while (cursor);
    return started;
};

const runOne = async (env: ScheduleEnv, kv: ScheduleKv, key: string, at: number): Promise<boolean> => {
    const raw = await kv.get(key);
    if (!raw) return false;
    const record = JSON.parse(raw) as ScheduleRecord;
    const secrets = await open<ReplySecrets>(record.sealed, sealingSecret(env));
    const rest = new FirestoreRest(firestoreConfig(env), new TokenSource(firestoreConfig(env), secrets.refreshToken || ''));
    const path = pathOf(record.boardId, record.scheduleId);

    let doc: Awaited<ReturnType<FirestoreRest['get']>>;
    try {
        doc = await rest.get(path);
    } catch (error) {
        // Not a member any more: the schedule cannot run as them.
        if (/PERMISSION_DENIED|permission|403/i.test(String((error as Error)?.message))) {
            await kv.delete(key);
            return false;
        }
        throw error;
    }
    if (!doc || doc.data.createdBy !== record.uid) {
        await kv.delete(key);
        return false;
    }
    const schedule = doc.data as Schedule;
    if (schedule.enabled === false || !isDue(schedule, at) || ranRecently(schedule.lastRunAt, at)) return false;

    // Claimed before anything is posted, so a retried tick does not post twice.
    await rest.update(path, { lastRunAt: at, lastError: '' });
    try {
        const timestamp = Date.now();
        const channel = `boards/${record.boardId}/channels/${schedule.channelId}`;
        await rest.create(`${channel}/messages`, {
            channelId: schedule.channelId,
            boardId: record.boardId,
            authorId: record.uid,
            postedBy: record.uid,
            authorName: schedule.createdByName || 'User',
            authorType: 'human',
            content: `@${schedule.bot} ${schedule.text}`,
            mentions: [schedule.bot],
            scheduled: record.scheduleId,
            timestamp
        });
        // Stamps for unread dots; best effort, as in the app.
        const stamp = { lastMessageAt: timestamp, lastMessageAuthorId: record.uid };
        await Promise.all([rest.update(channel, stamp), rest.update(`boards/${record.boardId}`, stamp)]).catch(() => { });
        await env.BOT_REPLIES!.create({
            id: `${record.uid}-${crypto.randomUUID()}`,
            params: {
                uid: record.uid,
                boardId: record.boardId,
                channelId: schedule.channelId,
                channelName: schedule.channelName || 'general',
                mentions: [schedule.bot],
                toolPolicy: 'auto',
                settings: record.settings,
                sealed: record.sealed,
                selfOrigin: record.selfOrigin
            },
            retention: { successRetention: '1 hour', errorRetention: '1 day' }
        });
    } catch (error) {
        await rest.update(path, { lastError: String((error as Error)?.message || error).slice(0, 300) }).catch(() => { });
        throw error;
    }
    return true;
};
