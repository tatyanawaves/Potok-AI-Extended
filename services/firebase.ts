
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, setDoc, getDocs } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
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
    const postRef = doc(db, 'posts', postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
        const post = postSnap.data();
        const comments = post.comments || [];
        const generateUUID = () => {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
            }
            return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        };
        comments.push({
            id: generateUUID(),
            timestamp: Date.now(),
            ...commentData
        });
        await updateDoc(postRef, { comments });
    }
};
export const toggleLike = async (postId: string, userId: string) => {
    const postRef = doc(db, 'posts', postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
        const post = postSnap.data();
        const likes = post.likes || 0;
        const likedBy = post.likedBy || [];
        const isLiked = likedBy.includes(userId);

        await updateDoc(postRef, {
            likes: isLiked ? Math.max(0, likes - 1) : likes + 1,
            likedBy: isLiked ? likedBy.filter(id => id !== userId) : [...likedBy, userId]
        });
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
