/**
 * Sealing the secrets a server task carries.
 *
 * A task runs on the user's model key and signs in to Firestore with their
 * refresh token. Workflow parameters are stored by Cloudflare for the life of
 * the instance, so those two never go in as plain text: they are encrypted
 * with AES-GCM under a key derived from a worker secret, and only the running
 * task opens them. The instance is also created with a short retention (see
 * ./agentTasks), after which Cloudflare drops even the sealed copy.
 */

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** One key per purpose, derived rather than stored: HKDF over the worker secret. */
const deriveKey = async (secret: string): Promise<CryptoKey> => {
    if (!secret) throw new Error('Server tasks are not configured: no sealing secret');
    const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('potok-agent-tasks'), info: encoder.encode('task-credentials-v1') },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

export const seal = async (value: unknown, secret: string): Promise<string> => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, await deriveKey(secret), encoder.encode(JSON.stringify(value))
    );
    return `${toBase64(iv)}.${toBase64(new Uint8Array(data))}`;
};

export const open = async <T>(sealed: string, secret: string): Promise<T> => {
    const [iv, data] = sealed.split('.');
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(iv) }, await deriveKey(secret), fromBase64(data)
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
};
