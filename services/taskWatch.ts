/**
 * Which of a person's server tasks have just finished, from one snapshot to
 * the next. Pure, so it can be tested without Firestore.
 */

export interface WatchedTask {
    id: string;
    status: 'queued' | 'running' | 'done' | 'stopped' | 'failed';
    startedBy: string;
    task: string;
    progress?: number;
    error?: string;
}

const ACTIVE = new Set(['queued', 'running']);

/**
 * Tasks the user started that were active in `previous` and are not any
 * more. A task first seen already finished is not news: it ended before the
 * page was open. `previous` is updated in place.
 */
export const newlyFinished = <T extends WatchedTask>(previous: Map<string, string>, tasks: T[], uid: string): T[] => {
    const finished: T[] = [];
    for (const task of tasks) {
        if (task.startedBy !== uid) continue;
        const before = previous.get(task.id);
        if (before && ACTIVE.has(before) && !ACTIVE.has(task.status)) finished.push(task);
        previous.set(task.id, task.status);
    }
    return finished;
};

export const finishedText = (task: WatchedTask, language: string): string => {
    const name = task.task.length > 80 ? `${task.task.slice(0, 80)}…` : task.task;
    const words = {
        ru: { done: 'Задача готова', failed: 'Задача не удалась', stopped: 'Задача остановлена' },
        en: { done: 'Task done', failed: 'Task failed', stopped: 'Task stopped' },
        kk: { done: 'Тапсырма дайын', failed: 'Тапсырма орындалмады', stopped: 'Тапсырма тоқтатылды' }
    }[language as 'ru' | 'en' | 'kk'] || { done: 'Задача готова', failed: 'Задача не удалась', stopped: 'Задача остановлена' };
    const head = task.status === 'done' ? words.done : task.status === 'failed' ? words.failed : words.stopped;
    const tail = task.status === 'done' && task.progress !== undefined ? ` · ${task.progress}%` : '';
    return `${head}${tail}: ${name}`;
};
