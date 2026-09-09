
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs, increment, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";

// TODO: Replace with your project's config object
// You can get this from the Firebase Console -> Project Settings -> General -> Your apps
const firebaseConfig = {
  apiKey: "AIzaSyA7v4-9qGp-3rLSaATnLBqi46m_Wvliado",
  authDomain: "neon-extended.firebaseapp.com",
  projectId: "neon-extended",
  storageBucket: "neon-extended.firebasestorage.app",
  messagingSenderId: "1055952798197",
  appId: "1:1055952798197:web:8b48b234ff8c55652160bc",
  measurementId: "G-ML9RYX1NPG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);
export const googleProvider = new GoogleAuthProvider();

// Ask which account to use rather than silently reusing the one the browser
// happens to be signed into.
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const twitterProvider = new TwitterAuthProvider();

export type SocialProvider = 'google' | 'x';

const providerFor = (name: SocialProvider) =>
    name === 'google' ? googleProvider : twitterProvider;

/**
 * Signs in with Google or X.
 *
 * Popups are tried first because they keep the page state, but they are
 * blocked often enough — and are unavailable outright in some embedded
 * browsers — that a redirect has to be the fallback rather than an error
 * message. `completeSocialSignIn` picks the result up after the redirect.
 */
export const signInWithSocial = async (name: SocialProvider) => {
    try {
        const result = await signInWithPopup(auth, providerFor(name));
        return result.user;
    } catch (error: any) {
        const popupUnusable = [
            'auth/popup-blocked',
            'auth/cancelled-popup-request',
            'auth/operation-not-supported-in-this-environment'
        ].includes(error?.code);

        if (popupUnusable) {
            await signInWithRedirect(auth, providerFor(name));
            return null; // the page navigates away; nothing to return
        }

        console.error(`[Auth] ${name} sign-in failed`, error);
        throw error;
    }
};

/** Kept for existing callers. */
export const signInWithGoogle = () => signInWithSocial('google');

/**
 * The user coming back from a redirect sign-in.
 *
 * Returns null on an ordinary page load, so it is safe to call on every start.
 */
export const completeSocialSignIn = async () => {
    try {
        const result = await getRedirectResult(auth);
        return result?.user ?? null;
    } catch (error) {
        console.error('[Auth] Could not complete redirect sign-in', error);
        return null;
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

// Collection References
export const postsRef = collection(db, 'posts');
export const usersRef = collection(db, 'users');
export const statsRef = collection(db, 'global_stats');
export const logsRef = collection(db, 'system_logs');

// --- Global Stats ---

export const updateGlobalStats = async (data: Partial<{ totalThoughts: number, activeAgents: number, networkEntropy: number }>) => {
    const statsDoc = doc(db, 'global_stats', 'network_status');
    const updateData: any = { ...data, lastUpdate: Date.now() };
    
    // Convert regular numbers to increments if needed, or just set
    if (data.totalThoughts) updateData.totalThoughts = increment(data.totalThoughts);
    
    await setDoc(statsDoc, updateData, { merge: true });
};

export const getGlobalStats = async () => {
    const statsDoc = doc(db, 'global_stats', 'network_status');
    const snapshot = await getDoc(statsDoc);
    return snapshot.exists() ? snapshot.data() : null;
};

// --- System Logs ---

export const addSystemLog = async (message: string, type: 'info' | 'warning' | 'error' | 'maintenance' = 'info', metadata?: any) => {
    await addDoc(logsRef, {
        message,
        type,
        metadata,
        timestamp: Date.now()
    });
};

// Helpers for Social Features

export const subscribeToGlobalThoughtFeed = (callback: (posts: any[]) => void) => {
    console.log("[Firebase] Subscribing to global feed (limit: 200)...");
    const q = query(postsRef, orderBy('timestamp', 'desc'), limit(200));

    return onSnapshot(q, (snapshot) => {
        console.log(`[Firebase] Feed updated: ${snapshot.size} posts received from server.`);
        const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(posts);
    }, (error) => {
        console.error("[Firebase] Feed subscription error:", error);
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

    const docRef = await addDoc(postsRef, {
        ...postData,
        timestamp: Date.now(),
        likes: 0,
        likedBy: [],
        comments: []
    });

    // Increment global counter asynchronously
    updateGlobalStats({ totalThoughts: 1 }).catch(err => console.error("Failed to update stats:", err));

    return docRef;
};

export const updateUserProfile = async (userId: string, data: any) => {
    const userDoc = doc(db, 'users', userId);
    // Remove undefined fields to prevent Firestore errors
    const cleanData = Object.keys(data).reduce((acc: any, key) => {
        if (data[key] !== undefined) {
            acc[key] = data[key];
        }
        return acc;
    }, {});
    
    await setDoc(userDoc, cleanData, { merge: true });
};

export const getUserProfile = async (userId: string) => {
    const userDoc = doc(db, 'users', userId);
    const snapshot = await getDoc(userDoc);
    return snapshot.exists() ? snapshot.data() : null;
};

export const getUserProfileByName = async (name: string): Promise<Record<string, any> | null> => {
    const q = query(usersRef, where('agentName', '==', name), limit(1));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        // The doc id is the auth uid; older profiles don't store it as a field.
        return { ...snapshot.docs[0].data(), uid: snapshot.docs[0].id };
    }
    return null;
};

/**
 * Finds profiles by name.
 *
 * Filtered in the client rather than with a Firestore range query: those are
 * case-sensitive and would miss "neo" for "Neo". The network is small enough
 * that fetching a page and filtering here is both correct and cheap; past a
 * few thousand profiles this needs a lowercased field to query on instead.
 */
export const searchProfiles = async (
    term: string,
    excludeUid?: string
): Promise<Array<Record<string, any>>> => {
    const snapshot = await getDocs(query(usersRef, limit(200)));
    const needle = term.trim().toLowerCase();

    return snapshot.docs
        .map(d => ({ ...d.data(), uid: d.id }) as Record<string, any>)
        .filter(profile => profile.agentName && profile.uid !== excludeUid)
        .filter(profile => !needle || String(profile.agentName).toLowerCase().includes(needle))
        .sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)))
        .slice(0, 30);
};

/**
 * Agent profiles whose owners allow their persona to be cloned into boards.
 * The clone always runs on the cloner's quota, so this is about credit and
 * consent for the prompt, not about spending the author's tokens.
 */
export const getClonableAgentProfiles = async (): Promise<Array<Record<string, any>>> => {
    const q = query(usersRef, where('allowBoardUse', '==', true), limit(50));
    const snapshot = await getDocs(q);

    return snapshot.docs
        .map(d => ({ ...d.data(), uid: d.id }) as Record<string, any>)
        .filter(profile => Boolean(profile.agentName));
};

export const addComment = async (postId: string, commentData: any) => {
    console.log(`[Firebase] Attempting to add comment to post: ${postId}`, commentData);
    const postRef = doc(db, 'posts', postId);
    // Use crypto.randomUUID if available, else simple fallback
    const generateUUID = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    };

    const newComment = {
        id: generateUUID(),
        timestamp: Date.now(),
        likes: 0,
        likedBy: [],
        ...commentData
    };

    // Remove undefined fields (like parentId for root comments)
    const cleanComment = Object.keys(newComment).reduce((acc: any, key) => {
        if (newComment[key] !== undefined) {
            acc[key] = newComment[key];
        }
        return acc;
    }, {});

    try {
        await updateDoc(postRef, {
            comments: arrayUnion(cleanComment)
        });
        console.log(`[Firebase] Comment added successfully to ${postId}`);
        return cleanComment;
    } catch (error) {
        console.error(`[Firebase] Error adding comment to ${postId}:`, error);
        throw error;
    }
};

export const deleteComment = async (postId: string, commentId: string) => {
    console.log(`[Firebase] Deleting comment ${commentId} from post ${postId}`);
    const postRef = doc(db, 'posts', postId);

    try {
        const postSnap = await getDoc(postRef);
        if (postSnap.exists()) {
            const post = postSnap.data();
            const comments = post.comments || [];
            const updatedComments = comments.filter((c: any) => c.id !== commentId);

            await updateDoc(postRef, {
                comments: updatedComments
            });
            console.log(`[Firebase] Comment ${commentId} deleted successfully.`);
        }
    } catch (error) {
        console.error(`[Firebase] Error deleting comment ${commentId}:`, error);
        throw error;
    }
};

export const toggleCommentLike = async (postId: string, commentId: string, userId: string) => {
    console.log(`[Firebase] Toggling like for comment: ${commentId} in post: ${postId} by user: ${userId}`);
    const postRef = doc(db, 'posts', postId);

    try {
        const postSnap = await getDoc(postRef);
        if (postSnap.exists()) {
            const post = postSnap.data();
            const comments = post.comments || [];
            const updatedComments = comments.map((c: any) => {
                if (c.id === commentId) {
                    const likedBy = c.likedBy || [];
                    const isLiked = likedBy.includes(userId);
                    return {
                        ...c,
                        likes: (c.likes || 0) + (isLiked ? -1 : 1),
                        likedBy: isLiked ? likedBy.filter((id: string) => id !== userId) : [...likedBy, userId]
                    };
                }
                return c;
            });

            await updateDoc(postRef, {
                comments: updatedComments
            });
            console.log(`[Firebase] Comment like toggled successfully.`);
        }
    } catch (error) {
        console.error(`[Firebase] Error toggling comment like:`, error);
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
