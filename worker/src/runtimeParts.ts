/**
 * Pieces shared by everything that runs bots on this worker — server tasks
 * (./agentTasks) and replies to mentions (./botReplies).
 */

import type { FirestoreRest } from './firestoreRest';
import { dailyLimitOf, overLimit, limitMessage, addToDay, type UsageHooks } from '../../services/spendLimit';
import { dayKey } from '../../services/usage';

/** Board files through this worker's own /files with the user's token, so membership is checked as for the app. */
export const fileReaders = (
    selfOrigin: string,
    selfFetch: (request: Request) => Promise<Response>,
    token: () => Promise<string>
) => {
    const readOwnFile = async (key: string): Promise<Response> => {
        const url = new URL('/files', selfOrigin);
        url.searchParams.set('key', key);
        const response = await selfFetch(new Request(url, { headers: { Authorization: `Bearer ${await token()}` } }));
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        return response;
    };
    return {
        readAttachment: async (key: string) => (await readOwnFile(key)).text(),
        readAttachmentDataUrl: async (key: string, contentType: string) => {
            const bytes = new Uint8Array(await (await readOwnFile(key)).arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return `data:${contentType};base64,${btoa(binary)}`;
        }
    };
};

/**
 * The person's daily ceiling, counted in the same tally as in the browser.
 * Per run, not module-wide: runs of different people share this process.
 */
export const usageHooksFor = (rest: FirestoreRest, uid: string, settings: { dailyRequestLimit?: number }): UsageHooks => {
    const spendPath = `users/${uid}/private/spend`;
    const limit = dailyLimitOf(settings);
    return {
        gate: async () => {
            if (limit <= 0) return;
            const doc = await rest.get(spendPath).catch(() => null);
            const used = Number(doc?.data?.days?.[dayKey()]?.requests || 0);
            if (overLimit(used, limit)) throw new Error(limitMessage(limit));
        },
        record: async (tokens, cost) => {
            const doc = await rest.get(spendPath).catch(() => null);
            const days = addToDay(doc?.data?.days, dayKey(), tokens, 1, cost || 0);
            if (doc) await rest.update(spendPath, { days });
            else await rest.create(`users/${uid}/private`, { days }, 'spend');
        }
    };
};

/** How long a person has to answer a tool request before it counts as a no. */
export const APPROVAL_TIMEOUT_MS = 120_000;
const APPROVAL_POLL_MS = 1_500;

/**
 * Asks the person who called the bot, from the server: a request document
 * their open tab shows as the usual dialog and answers. No answer in time is
 * a no. Rules: only that person reads it and only they set its status.
 */
export const approvalVia = (rest: FirestoreRest, boardId: string, uid: string, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) =>
    async (bot: string, tool: string, args: Record<string, any>, reason?: 'foreign'): Promise<boolean> => {
        const id = crypto.randomUUID();
        const path = `boards/${boardId}/approvals/${id}`;
        await rest.create(`boards/${boardId}/approvals`, {
            requestedBy: uid, bot, tool,
            args: JSON.stringify(args).slice(0, 4000),
            ...(reason ? { reason } : {}),
            status: 'pending',
            createdAt: Date.now()
        }, id);
        const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
        try {
            while (Date.now() < deadline) {
                await sleep(APPROVAL_POLL_MS);
                const doc = await rest.get(path).catch(() => null);
                if (doc?.data.status === 'allowed') return true;
                if (doc?.data.status === 'denied') return false;
            }
            return false;
        } finally {
            await rest.delete(path).catch(() => { });
        }
    };

/** How often a reply being written is saved for the channel to show. */
const DRAFT_EVERY_MS = 800;

/**
 * The reply as the model writes it, kept in a draft document the channel
 * shows until the finished message arrives. Throttled; `done` removes it.
 */
export const draftWriter = (rest: FirestoreRest, boardId: string, channelId: string, uid: string) => {
    const pending = new Map<string, { name: string, text: string }>();
    const written = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let chain = Promise.resolve();

    const flush = () => {
        timer = null;
        const batch = [...pending.entries()];
        pending.clear();
        chain = chain.then(async () => {
            for (const [botId, { name, text }] of batch) {
                const path = `boards/${boardId}/channels/${channelId}/drafts/${botId}`;
                const data = { botName: name, text: text.slice(-8000), postedBy: uid, updatedAt: Date.now() };
                try {
                    if (written.has(botId)) await rest.update(path, data);
                    else { await rest.create(`boards/${boardId}/channels/${channelId}/drafts`, data, botId).catch(() => rest.update(path, data)); written.add(botId); }
                } catch { /* a draft is a courtesy; the reply itself still lands */ }
            }
        });
    };

    // Once the reply is posted, a late delta must not bring the draft back:
    // it would sit under the reply for good.
    let closed = false;

    return {
        write: (botId: string, name: string, text: string) => {
            if (closed) return;
            pending.set(botId, { name, text });
            timer ??= setTimeout(flush, DRAFT_EVERY_MS);
        },
        done: async () => {
            closed = true;
            if (timer) { clearTimeout(timer); timer = null; }
            pending.clear();
            await chain;
            await Promise.all([...written].map(botId =>
                rest.delete(`boards/${boardId}/channels/${channelId}/drafts/${botId}`).catch(() => { })));
            written.clear();
        }
    };
};
