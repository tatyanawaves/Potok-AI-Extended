import CryptoJS from 'crypto-js';

// Simple encryption service for local storage
// In a real production app, the key management would be more complex
// Here we use a user-provided or generated session key if available, 
// otherwise we rely on obscuring it from plain text.

const STORAGE_PREFIX = 'potok_secure_';

export const encryptData = (data: string, secretKey: string): string => {
    if (!data || !secretKey) return data;
    try {
        return CryptoJS.AES.encrypt(data, secretKey).toString();
    } catch (e) {
        console.error("Encryption failed", e);
        return data;
    }
};

export const decryptData = (ciphertext: string, secretKey: string): string => {
    if (!ciphertext || !secretKey) return ciphertext;
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.error("Decryption failed", e);
        return '';
    }
};

// Helper to manage secure local storage
export const secureStorage = {
    setItem: (key: string, value: string) => {
        // We use a fixed client-side salt for basic obfuscation if no user password is set
        // This protects against casual snooping but not determined attacks with access to source
        const salt = 'potok-neural-client-salt-v1';
        const encrypted = encryptData(value, salt);
        localStorage.setItem(STORAGE_PREFIX + key, encrypted);
    },

    getItem: (key: string): string | null => {
        const encrypted = localStorage.getItem(STORAGE_PREFIX + key);
        if (!encrypted) return null;
        const salt = 'potok-neural-client-salt-v1';
        return decryptData(encrypted, salt);
    },

    removeItem: (key: string) => {
        localStorage.removeItem(STORAGE_PREFIX + key);
    }
};
