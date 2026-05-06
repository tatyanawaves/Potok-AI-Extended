
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs, increment, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";
import type { BoardKind } from '../types';

// TODO: Replace with your project's config object
// You can get this from the Firebase Console -> Project Settings -> General -> Your apps
const firebaseConfig = {
    apiKey: "AIzaSyCt9A6-2ON2mDcS14h6q_cWC2TyUUdhgyA",
    authDomain: "potok-33.firebaseapp.com",
    projectId: "potok-33",
    storageBucket: "potok-33.firebasestorage.app",
    messagingSenderId: "165805440425",
    appId: "1:165805440425:web:7d035685411b65060118b8",
    measurementId: "G-RW2MNFK64T"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account'
});

const ENV_PROXY_URL =
    (import.meta as any).env.VITE_OPENAI_PROXY_URL ||
    '/api/openai';

const BACKEND_BASE_URL =
    (import.meta as any).env.VITE_CODEX_BACKEND_URL ||
    ENV_PROXY_URL.replace(/\/(?:openaiProxy|api\/openai)$/i, '');

const WORKSPACE_BACKEND =
    ((import.meta as any).env.VITE_WORKSPACE_BACKEND || 'firebase').toLowerCase();

const useWorkspaceApi = () =>
    WORKSPACE_BACKEND === 'supabase' ||
    WORKSPACE_BACKEND === 'api' ||
    WORKSPACE_BACKEND === 'backend';

const workspaceEndpoint = (path: string) => `${BACKEND_BASE_URL}${path}`;

async function callWorkspaceBackend<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    if (!auth.currentUser) {
        throw new Error('Нужно войти в NEON, чтобы работать с тредами.');
    }

    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(workspaceEndpoint(path), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
    });

    const text = await response.text();
    let data: any = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { error: text };
    }

    if (!response.ok) {
        throw new Error(data.error || data.message || `Workspace backend failed: ${response.status}`);
    }

    return data as T;
}

function subscribeByPolling<T>(
    load: () => Promise<T[]>,
    callback: (items: T[]) => void,
    onError?: (error: Error) => void,
    intervalMs = 2500
) {
    let active = true;
    let busy = false;

    const poll = async () => {
        if (!active || busy) return;
        busy = true;
        try {
            const items = await load();
            if (active) callback(items);
        } catch (error: any) {
            if (active) onError?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
            busy = false;
        }
    };

    poll();
    const timer = window.setInterval(poll, intervalMs);
    return () => {
        active = false;
        window.clearInterval(timer);
    };
}

export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error("Google Sign In Error", error);
        throw error;
    }
};

export const signInWithGoogleRedirectFlow = async () => {
    try {
        await signInWithRedirect(auth, googleProvider);
    } catch (error) {
        console.error("Google Redirect Sign In Error", error);
        throw error;
    }
};

export const getGoogleRedirectUser = async () => {
    try {
        const result = await getRedirectResult(auth);
        return result?.user ?? null;
    } catch (error) {
        console.error("Google Redirect Result Error", error);
        throw error;
    }
};

export const logout = async () => {
    await signOut(auth);
};

export const registerWithEmail = async (email, password) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        console.error("Error registering with email", error);
        throw error;
    }
};

export const loginWithEmail = async (email, password) => {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        console.error("Error logging in with email", error);
        throw error;
    }
};

export const loginAnonymously = async () => {
    try {
        const userCredential = await signInAnonymously(auth);
        return userCredential.user;
    } catch (error) {
        console.error("Error signing in anonymously", error);
        throw error;
    }
};

// Collection References
export const postsRef = collection(db, 'posts');
export const usersRef = collection(db, 'users');
export const boardsRef = collection(db, 'boards');

// Helpers for Social Features

export const subscribeToFeed = (callback: (posts: any[]) => void) => {
    // Simple query: get recent 50 posts
    // In a real app, you'd filter by following or interests here
    const q = query(postsRef, orderBy('timestamp', 'desc'), limit(50));

    return onSnapshot(q, (snapshot) => {
        const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(posts);
    });
};

export const createPost = async (postData: any) => {
    if (!postData.authorId) {
        console.warn("[Firebase] Warning: Creating post without authorId! This post will not be deletable.", postData);
        // Try to patch it if user is logged in
        if (auth.currentUser) {
            console.log("[Firebase] Patching missing authorId with current user.");
            postData.authorId = auth.currentUser.uid;
        }
    }

    return await addDoc(postsRef, {
        ...postData,
        timestamp: Date.now(),
        likes: 0,
        likedBy: [],
        comments: []
    });
};

export const updateUserProfile = async (userId: string, data: any) => {
    const userDoc = doc(db, 'users', userId);
    await setDoc(userDoc, data, { merge: true });
};

export const getUserProfile = async (userId: string) => {
    const userDoc = doc(db, 'users', userId);
    const snapshot = await getDoc(userDoc);
    return snapshot.exists() ? snapshot.data() : null;
};

export const getUserProfileByName = async (name: string) => {
    const q = query(usersRef, where('agentName', '==', name), limit(1));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        return snapshot.docs[0].data();
    }
    return null;
};

export const addComment = async (postId: string, commentData: any) => {
    console.log(`[Firebase] Attempting to add comment to post: ${postId}`, commentData);
    const postRef = doc(db, 'posts', postId);
    const generateUUID = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    };

    const newComment = {
        id: generateUUID(),
        timestamp: Date.now(),
        ...commentData
    };

    try {
        await updateDoc(postRef, {
            comments: arrayUnion(newComment)
        });
        console.log(`[Firebase] Comment added successfully to ${postId}`);
    } catch (error) {
        console.error(`[Firebase] Error adding comment to ${postId}:`, error);
        throw error;
    }
};

export const toggleLike = async (postId: string, userId: string) => {
    console.log(`[Firebase] Toggling like for post: ${postId} by user: ${userId}`);
    const postRef = doc(db, 'posts', postId);
    
    try {
        const postSnap = await getDoc(postRef);

        if (postSnap.exists()) {
            const post = postSnap.data();
            const likedBy = post.likedBy || [];
            const isLiked = likedBy.includes(userId);

            await updateDoc(postRef, {
                likes: increment(isLiked ? -1 : 1),
                likedBy: isLiked ? arrayRemove(userId) : arrayUnion(userId)
            });
            console.log(`[Firebase] Like toggled successfully for ${postId}. New state: ${!isLiked}`);
        } else {
            console.error(`[Firebase] Post ${postId} does not exist`);
            throw new Error("Пост не найден в базе данных");
        }
    } catch (error) {
        console.error(`[Firebase] Error toggling like for ${postId}:`, error);
        throw error;
    }
};

export const deletePost = async (postId: string) => {
    console.log(`[Firebase] Attempting to delete post: ${postId}`);
    const postRef = doc(db, 'posts', postId);
    
    try {
        // Debug: Check document ownership before deleting
        const docSnap = await getDoc(postRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const currentUid = auth.currentUser?.uid;
            console.log(`[Firebase] Debug Delete: Post AuthorId: '${data.authorId}', Current User UID: '${currentUid}'`);
            
            if (data.authorId !== currentUid) {
                console.warn(`[Firebase] ID Mismatch! You cannot delete this post because you are not the author.`);
            }
        } else {
             console.warn(`[Firebase] Document ${postId} does not exist before delete.`);
        }

        await deleteDoc(postRef);
        console.log(`[Firebase] Post deleted successfully: ${postId}`);
    } catch (error) {
        console.error(`[Firebase] Error deleting post ${postId}:`, error);
        throw error;
    }
};

export const getUserPosts = async (userId: string, agentName?: string) => {
    console.log(`[Firebase] Fetching posts for: ID='${userId}', Name='${agentName}'`);
    let posts: any[] = [];

    try {
        // Strategy 1: Search by AuthorId (Simple query, no index needed)
        if (userId) {
            const q = query(postsRef, where('authorId', '==', userId), limit(100));
            const snapshot = await getDocs(q);
            posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Strategy 2: If no posts found by ID, try by Name (Simple query)
        if (posts.length === 0 && agentName) {
            console.log(`[Firebase] Trying by name: ${agentName}`);
            const q = query(postsRef, where('authorName', '==', agentName), limit(100));
            const snapshot = await getDocs(q);
            posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Always sort client-side to ensure newest are first, regardless of index status
        if (posts.length > 0) {
            posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }

        console.log(`[Firebase] Total posts found and sorted: ${posts.length}`);
        return posts;
    } catch (error) {
        console.error("[Firebase] Critical error in getUserPosts:", error);
        return [];
    }
};

export const ensureDefaultBoards = async (userId: string, userName: string) => {
    if (useWorkspaceApi()) {
        await callWorkspaceBackend('/api/workspace/ensure-default', { userName });
        return;
    }

    const existingBoards = await getDocs(query(boardsRef, where('ownerId', '==', userId), limit(50)));
    const hasCodexBoard = existingBoards.docs.some((boardDoc) => {
        const board = boardDoc.data();
        return board.kind === 'codex' || board.codexEnabled === true;
    });

    if (hasCodexBoard) {
        return;
    }

    await addDoc(boardsRef, {
        ownerId: userId,
        name: 'Codex',
        kind: 'codex',
        codexEnabled: true,
        description: `Codex chat with workspace context for ${userName}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
};

export const subscribeToBoards = (
    userId: string,
    callback: (boards: any[]) => void,
    onError?: (error: Error) => void
) => {
    if (useWorkspaceApi()) {
        return subscribeByPolling(
            async () => {
                const data = await callWorkspaceBackend<{ ok: boolean; threads: any[] }>('/api/threads/list');
                return data.threads || [];
            },
            callback,
            onError
        );
    }

    const q = query(boardsRef, where('ownerId', '==', userId));
    return onSnapshot(q, (snapshot) => {
        const boards = snapshot.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
        callback(boards);
    }, (error) => {
        console.error('[Firebase] subscribeToBoards failed:', error);
        onError?.(error);
    });
};

export const createBoard = async (
    userId: string,
    name: string,
    kind: BoardKind = 'codex',
    description?: string,
    codexEnabled = true
) => {
    if (useWorkspaceApi()) {
        const data = await callWorkspaceBackend<{ ok: boolean; thread: any }>('/api/threads/create', {
            name,
            kind,
            description: description || '',
            codexEnabled,
        });
        return { id: data.thread.id, ...data.thread };
    }

    return addDoc(boardsRef, {
        ownerId: userId,
        name,
        kind,
        codexEnabled,
        description: description || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
};

export const setBoardCodexEnabled = async (boardId: string, enabled: boolean) => {
    if (useWorkspaceApi()) {
        await callWorkspaceBackend('/api/threads/update-codex', { threadId: boardId, enabled });
        return;
    }

    const boardRef = doc(db, 'boards', boardId);
    await updateDoc(boardRef, {
        codexEnabled: enabled,
        updatedAt: Date.now()
    });
};

export const getBoardMessagesRef = (boardId: string) => collection(db, 'boards', boardId, 'messages');

export const subscribeToBoardMessages = (
    boardId: string,
    callback: (messages: any[]) => void,
    onError?: (error: Error) => void
) => {
    if (useWorkspaceApi()) {
        return subscribeByPolling(
            async () => {
                const data = await callWorkspaceBackend<{ ok: boolean; messages: any[] }>('/api/messages/list', {
                    threadId: boardId,
                });
                return data.messages || [];
            },
            callback,
            onError,
            2000
        );
    }

    const q = query(getBoardMessagesRef(boardId), orderBy('createdAt', 'asc'), limit(200));
    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(docSnap => ({ id: docSnap.id, boardId, ...docSnap.data() }));
        callback(messages);
    }, (error) => {
        console.error('[Firebase] subscribeToBoardMessages failed:', error);
        onError?.(error);
    });
};

export const createBoardMessage = async (
    boardId: string,
    message: {
        authorId: string;
        authorName: string;
        authorType: 'human' | 'agent';
        content: string;
    }
) => {
    if (useWorkspaceApi()) {
        await callWorkspaceBackend('/api/messages/create', {
            threadId: boardId,
            message,
        });
        return;
    }

    const boardRef = doc(db, 'boards', boardId);
    await addDoc(getBoardMessagesRef(boardId), {
        ...message,
        boardId,
        createdAt: Date.now()
    });
    await updateDoc(boardRef, {
        updatedAt: Date.now(),
        lastMessagePreview: message.content.slice(0, 120)
    });
};
