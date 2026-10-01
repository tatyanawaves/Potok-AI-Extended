import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AISettings, BoardMember, BoardMessage } from '../types';
import { dailyLimitOf } from './spendLimit';
import { toolServersOf } from './runtime/turn';
import { verifyReply, needsSignature } from './botSignature';

/**
 * Bot replies written and signed by the worker (worker/src/botReplies.ts),
 * and what the app needs around them: answering the tool requests the server
 * sends, showing the reply as it is written, and telling which bot replies
 * the server signed.
 */

const WORKER: string = (import.meta.env.VITE_PIPEDREAM_WORKER_URL || '').replace(/\/$/, '');

/** Tools on this machine (the bridge, Docker) are out of the server's reach. */
const isLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);

/** Whether these bots can be answered on the server; otherwise the browser answers, unsigned. */
export const canReplyOnServer = (bots: BoardMember[]): boolean =>
    Boolean(WORKER) && bots.every(bot => !toolServersOf(bot).some(isLocal));

export const replyOnServer = async (options: {
    boardId: string, channelId: string, channelName: string, mentions: string[], settings: AISettings
}): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const { settings } = options;
    if (!settings.openRouterKey || settings.openRouterKey === 'google-auth') {
        throw new Error('Нужен ключ API в настройках — бот ответит на нём');
    }
    // A little longer than the server's own deadline (worker/src/botReplies.ts).
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 5 * 60_000);
    const response = await fetch(`${WORKER}/bots/reply`, {
        signal: deadline.signal,
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            boardId: options.boardId,
            channelId: options.channelId,
            channelName: options.channelName,
            mentions: options.mentions,
            apiKey: settings.openRouterKey,
            mcpTokens: settings.mcpTokens || {},
            settings: {
                apiBaseUrl: settings.apiBaseUrl || undefined,
                openRouterModel: settings.openRouterModel || undefined,
                memoryModel: settings.memoryModel || undefined,
                embeddingModel: settings.embeddingModel || undefined,
                fallbackModel: settings.fallbackModel || undefined,
                dailyRequestLimit: dailyLimitOf(settings),
                language: settings.language
            }
        })
    }).catch(error => {
        throw deadline.signal.aborted ? new Error('Сервер не ответил за 5 минут — бот, похоже, завис. Попробуйте ещё раз.') : error;
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as any).error || `Сервер ответил ${response.status}`);
    }
};

// --- Tool requests from the server ----------------------------------------------

export interface ApprovalRequest {
    id: string;
    bot: string;
    tool: string;
    args: Record<string, any>;
    foreign: boolean;
}

/** Tool requests the server is waiting on this person to answer, on one board. */
export const subscribeToApprovals = (boardId: string, callback: (requests: ApprovalRequest[]) => void) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => { };
    return onSnapshot(
        query(collection(db, 'boards', boardId, 'approvals'), where('requestedBy', '==', uid), where('status', '==', 'pending')),
        snap => callback(snap.docs.map(d => {
            const data = d.data();
            let args: Record<string, any> = {};
            try { args = JSON.parse(String(data.args || '{}')); } catch { /* shown empty */ }
            return { id: d.id, bot: String(data.bot || ''), tool: String(data.tool || ''), args, foreign: data.reason === 'foreign' };
        })),
        () => callback([])
    );
};

export const answerApproval = (boardId: string, id: string, allowed: boolean) =>
    updateDoc(doc(db, 'boards', boardId, 'approvals', id), { status: allowed ? 'allowed' : 'denied' });

// --- Replies being written -------------------------------------------------------

export interface Draft { botId: string, botName: string, text: string }

export const subscribeToDrafts = (boardId: string, channelId: string, callback: (drafts: Draft[]) => void) =>
    onSnapshot(
        collection(db, 'boards', boardId, 'channels', channelId, 'drafts'),
        snap => callback(snap.docs.map(d => ({ botId: d.id, botName: String(d.data().botName || ''), text: String(d.data().text || '') }))),
        () => callback([])
    );

// --- Signed replies --------------------------------------------------------------

let publicKey: Promise<string | null> | null = null;

/** The worker's public key, or null when signing is off (then nothing is checked). */
export const signingKey = (): Promise<string | null> => {
    publicKey ??= (WORKER
        ? fetch(`${WORKER}/bots/key`).then(r => r.ok ? r.json() : null).then(data => (data as any)?.publicKey || null)
        : Promise.resolve(null)
    ).catch(() => { publicKey = null; return null; });
    return publicKey;
};

/**
 * 'signed', 'unsigned' (a bot message the server should have signed and did
 * not), or null when there is nothing to say: not a bot message, from before
 * signatures, or signing is off.
 */
export const signatureState = async (message: BoardMessage, botIds: Set<string>): Promise<'signed' | 'unsigned' | null> => {
    if (!needsSignature(message, botIds)) return null;
    const key = await signingKey();
    if (!key) return null;
    return (await verifyReply(key, message as any)) ? 'signed' : 'unsigned';
};

/** For the runtime in this tab: believe a bot's message only if the server signed it. */
export const isAuthentic = async (message: BoardMessage): Promise<boolean> => {
    const key = await signingKey();
    return !key || verifyReply(key, message as any);
};
