import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { subscribeToConversations } from '../services/messages';
import { subscribeToMyBoards } from '../services/boards';
import {
    subscribeToReadState, isConversationUnread, isBoardUnread, EMPTY_READ_STATE
} from '../services/reads';
import { Board, Conversation } from '../types';

/**
 * Whether anything is waiting, for the navigation dots.
 *
 * The lists it watches are the same ones Messages and Boards already
 * subscribe to, so a badge costs no reads beyond the shared read-state
 * document — and the navigation can say something arrived without the user
 * having to open the section to find out.
 */
export const useUnread = (): { messages: boolean, boards: boolean } => {
    const [uid, setUid] = useState<string | undefined>(auth.currentUser?.uid);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [boards, setBoards] = useState<Board[]>([]);
    const [reads, setReads] = useState(EMPTY_READ_STATE);

    useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid)), []);

    useEffect(() => {
        if (!uid) {
            setConversations([]);
            setBoards([]);
            return;
        }

        const stop = [
            subscribeToConversations(uid, setConversations),
            subscribeToMyBoards(uid, setBoards),
            subscribeToReadState(uid, setReads)
        ];

        return () => stop.forEach(unsubscribe => unsubscribe());
    }, [uid]);

    if (!uid) return { messages: false, boards: false };

    return {
        messages: conversations.some(c => isConversationUnread(c, reads, uid)),
        boards: boards.some(b => isBoardUnread(b, reads, uid))
    };
};
