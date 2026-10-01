import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { subscribeToMyBoards } from '../services/boards';
import { subscribeToTasks, serverTasksAvailable, ServerTask } from '../services/serverTasks';
import { newlyFinished, finishedText } from '../services/taskWatch';

export interface TaskNotice { id: string, boardId: string, text: string, ok: boolean }

/**
 * Tells the person when a task they started on the server ends, wherever
 * they are in the app: a notice on the page, and a system notification when
 * the tab is in the background and they allowed it.
 */
export const useTaskNotifications = (language: string) => {
    const [uid, setUid] = useState<string | undefined>(auth.currentUser?.uid);
    useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid)), []);
    const [notices, setNotices] = useState<TaskNotice[]>([]);
    const seen = useRef(new Map<string, string>());
    const languageRef = useRef(language);
    languageRef.current = language;

    useEffect(() => {
        if (!uid || !serverTasksAvailable()) return;
        const perBoard = new Map<string, () => void>();

        const onTasks = (boardId: string, tasks: ServerTask[]) => {
            for (const task of newlyFinished(seen.current, tasks, uid)) {
                const text = finishedText(task, languageRef.current);
                setNotices(list => [...list.filter(n => n.id !== task.id), { id: task.id, boardId, text, ok: task.status === 'done' }].slice(-3));
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
                    try { new Notification('Potok', { body: text, tag: task.id }); } catch { /* some browsers only allow it from a service worker */ }
                }
            }
        };

        const stopBoards = subscribeToMyBoards(uid, boards => {
            const ids = new Set(boards.map(b => b.id!));
            for (const [id, stop] of perBoard) if (!ids.has(id)) { stop(); perBoard.delete(id); }
            for (const id of ids) if (!perBoard.has(id)) perBoard.set(id, subscribeToTasks(id, tasks => onTasks(id, tasks)));
        });

        return () => {
            stopBoards();
            for (const stop of perBoard.values()) stop();
        };
    }, [uid]);

    const dismiss = (id: string) => setNotices(list => list.filter(n => n.id !== id));
    return { notices, dismiss };
};

/** Asked when a task is sent to the server, the moment the person wants to hear back. */
export const askForTaskNotifications = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => { });
    }
};
