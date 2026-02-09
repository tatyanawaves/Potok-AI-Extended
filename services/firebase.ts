
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs, increment, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
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

export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error("Google Sign In Error", error);
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
        ...commentData
    };

    try {
        await updateDoc(postRef, {
            comments: arrayUnion(newComment)
        });
        console.log(`[Firebase] Comment added successfully to ${postId}`);
        return newComment;
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
