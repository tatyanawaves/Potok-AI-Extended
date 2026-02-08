
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs, increment, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";

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
    let q = query(postsRef, where('authorId', '==', userId), orderBy('timestamp', 'desc'), limit(100));
    let snapshot = await getDocs(q);

    // Fallback if no posts with ID are found but name is provided
    if (snapshot.empty && agentName) {
        q = query(postsRef, where('authorName', '==', agentName), orderBy('timestamp', 'desc'), limit(100));
        snapshot = await getDocs(q);
    }

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};
