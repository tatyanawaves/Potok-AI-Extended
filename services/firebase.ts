
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs, increment, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, TwitterAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";
import { Comment } from '../types';
import { NewComment, newCommentData } from './comments';

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

/**
 * Local test mode (`vite --mode emulator`, see .env.emulator).
 *
 * Everything goes to the Firebase emulators under a "demo-" project, which the
 * emulators treat as offline-only: no request can reach production, so test
 * accounts and test data never mix with real ones. The security rules are the
 * real ones from firestore.rules.
 */
export const usingEmulators = import.meta.env.VITE_FIREBASE_EMULATORS === '1';

const EMULATOR_PROJECT = 'demo-potok';

// Initialize Firebase
const app = initializeApp(usingEmulators
  ? { apiKey: 'demo-key', authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`, projectId: EMULATOR_PROJECT }
  : firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Analytics has no emulator and would report test sessions as real traffic.
export const analytics = usingEmulators ? null : getAnalytics(app);
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

/**
 * Sends Firebase's password-reset email. Firebase answers the same whether or
 * not the address has an account (email enumeration protection), so the UI
 * says "if an account exists" rather than "sent".
 */
export const resetPassword = async (email: string): Promise<void> => {
    auth.languageCode = 'ru';
    await sendPasswordResetEmail(auth, email.trim());
};

/** Whether the signed-in account has a password at all (not Google or X only). */
export const hasPasswordSignIn = (): boolean =>
    Boolean(auth.currentUser?.providerData.some(p => p.providerId === 'password'));

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

    // No comments field: comments are a subcollection (see addComment).
    const docRef = await addDoc(postsRef, {
        ...postData,
        timestamp: Date.now(),
        likes: 0,
        likedBy: []
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

// --- Comments ---
//
// One document per comment, under its post (see services/comments.ts for why).

const commentsRefFor = (postId: string) => collection(db, 'posts', postId, 'comments');

/** The most comments a post shows: its newest. */
const COMMENT_WINDOW = 500;

/** A post's comments, oldest first, kept up to date. */
export const subscribeToComments = (postId: string, callback: (comments: Comment[]) => void) => {
    // Newest first, then flipped, so a post past the window shows its latest
    // comments rather than its first ones.
    const q = query(commentsRefFor(postId), orderBy('timestamp', 'desc'), limit(COMMENT_WINDOW));

    return onSnapshot(q, (snapshot) => {
        const comments = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as Comment);
        comments.reverse();
        callback(comments);
    }, (error) => {
        console.error(`[Firebase] Comment subscription error for ${postId}:`, error);
    });
};

/**
 * Comments on a post as the signed-in user, the only author the rules
 * accept. An agent's comment is no exception: the agent runs in its owner's
 * browser and comments under their uid, with its own name on it.
 *
 * Returns the comment as stored, id included, so a reply can point at it.
 */
export const addComment = async (postId: string, comment: NewComment): Promise<Comment> => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Нужно войти в систему, чтобы комментировать");

    const data = newCommentData(uid, comment);

    try {
        const ref = await addDoc(commentsRefFor(postId), data);
        return { ...data, id: ref.id };
    } catch (error) {
        console.error(`[Firebase] Error adding comment to ${postId}:`, error);
        throw error;
    }
};

/**
 * Deletes one comment; the rules allow its author and the post's author.
 * Replies to it stay, and are shown at the top level.
 */
export const deleteComment = async (postId: string, commentId: string) => {
    try {
        await deleteDoc(doc(commentsRefFor(postId), commentId));
    } catch (error) {
        console.error(`[Firebase] Error deleting comment ${commentId}:`, error);
        throw error;
    }
};

/**
 * Likes a comment in `userId`'s name, or takes the like back. Only that uid
 * and the count by one may change; the rules refuse anything else.
 */
export const toggleCommentLike = async (postId: string, commentId: string, userId: string) => {
    const commentRef = doc(commentsRefFor(postId), commentId);

    try {
        const snapshot = await getDoc(commentRef);
        if (!snapshot.exists()) throw new Error("Комментарий не найден");

        const isLiked = (snapshot.get('likedBy') || []).includes(userId);

        await updateDoc(commentRef, {
            likes: increment(isLiked ? -1 : 1),
            likedBy: isLiked ? arrayRemove(userId) : arrayUnion(userId)
        });
    } catch (error) {
        console.error(`[Firebase] Error toggling like on comment ${commentId}:`, error);
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
            } else {
                // Comments are documents of their own and would outlive the
                // post. Its author may delete any of them. Only for the
                // author: anyone else would get as far as their own comments.
                const comments = await getDocs(commentsRefFor(postId));
                await Promise.all(comments.docs.map(c => deleteDoc(c.ref)));
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
