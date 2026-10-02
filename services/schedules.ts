import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AISettings } from '../types';
import { dailyLimitOf } from './spendLimit';
import type { Schedule } from './schedule';

/**
 * Scheduled bot requests on a board (services/schedule, worker/src/schedules).
 * The schedule is a board document everyone sees; the worker keeps, sealed,
 * what it needs to run it later as its creator.
 */

const WORKER: string = (import.meta.env.VITE_PIPEDREAM_WORKER_URL || '').replace(/\/$/, '');

export const schedulesAvailable = (): boolean => Boolean(WORKER);

const callWorker = async (path: string, body: unknown) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const response = await fetch(`${WORKER}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as any).error || `Сервер ответил ${response.status}`);
    }
};

export const subscribeToSchedules = (boardId: string, callback: (schedules: Schedule[]) => void) =>
    onSnapshot(
        query(collection(db, 'boards', boardId, 'schedules'), orderBy('createdAt', 'asc')),
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Schedule)),
        () => callback([])
    );

/** Hands the worker this person's key and sign-in, so it can run their schedule later. */
const arm = (boardId: string, scheduleId: string, settings: AISettings) => {
    const user = auth.currentUser!;
    if (!settings.openRouterKey || settings.openRouterKey === 'google-auth') {
        throw new Error('Нужен ключ API в настройках — расписание будет работать на нём');
    }
    return callWorker('/schedules/save', {
        boardId, scheduleId,
        apiKey: settings.openRouterKey,
        refreshToken: user.refreshToken,
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
    });
};

export const createSchedule = async (
    boardId: string,
    schedule: Omit<Schedule, 'id' | 'createdBy' | 'createdAt' | 'enabled'>,
    settings: AISettings
): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in');
    const ref = await addDoc(collection(db, 'boards', boardId, 'schedules'), {
        ...schedule,
        text: schedule.text.slice(0, 2000),
        createdBy: uid,
        enabled: true,
        createdAt: Date.now()
    });
    try {
        await arm(boardId, ref.id, settings);
    } catch (error) {
        // A schedule the server cannot run should not sit there looking armed.
        await deleteDoc(ref).catch(() => { });
        throw error;
    }
};

export const setScheduleEnabled = (boardId: string, id: string, enabled: boolean) =>
    updateDoc(doc(db, 'boards', boardId, 'schedules', id), { enabled });

export const deleteSchedule = async (boardId: string, id: string): Promise<void> => {
    await deleteDoc(doc(db, 'boards', boardId, 'schedules', id));
    await callWorker('/schedules/delete', { boardId, scheduleId: id }).catch(() => { /* the next tick forgets it */ });
};
