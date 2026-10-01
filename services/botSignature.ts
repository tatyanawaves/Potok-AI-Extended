/**
 * Bot replies the server vouches for.
 *
 * A member's browser can write a message as a board's bot — the rules must
 * allow it, since bots used to answer from the browser of whoever called
 * them. So a "reply from the bot" proved nothing: a member could put words
 * in its mouth, and the bot would then read them back as its own. Replies
 * the worker writes now carry an Ed25519 signature over what matters; only
 * the worker holds the private key. The app shows which replies are signed,
 * and a bot treats an unsigned message in its name as someone else's.
 *
 * WebCrypto only, so the same code runs in the worker, the browser and Node.
 */

export interface SignedFields {
    boardId: string;
    channelId: string;
    authorId: string;
    postedBy?: string;
    timestamp: number;
    content: string;
}

/** The exact bytes that are signed; any change to these fields breaks the signature. */
export const signedPayload = (m: SignedFields): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(['potok-bot-reply-v1', m.boardId, m.channelId, m.authorId, m.postedBy || '', m.timestamp, m.content]));

const toBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
};

/** From a base64 PKCS#8 private key (scripts/gen-signing-key.mjs). */
export const importSigningKey = async (pkcs8Base64: string): Promise<{ privateKey: CryptoKey, publicKey: string }> => {
    const der = Uint8Array.from(atob(pkcs8Base64.trim()), c => c.charCodeAt(0));
    const privateKey = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']);
    // The public half is in the private key's JWK as "x".
    const jwk = await crypto.subtle.exportKey('jwk', privateKey) as JsonWebKey;
    return { privateKey, publicKey: String(jwk.x) };
};

/** A key for this process only, for test mode where no secret is set. */
export const ephemeralSigningKey = async (): Promise<{ privateKey: CryptoKey, publicKey: string }> => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
    return { privateKey: pair.privateKey, publicKey: String(jwk.x) };
};

export const signReply = async (privateKey: CryptoKey, fields: SignedFields): Promise<string> =>
    toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, signedPayload(fields))));

const verifiers = new Map<string, Promise<CryptoKey>>();

/** `publicKey` is the base64url "x" of an Ed25519 JWK. */
export const verifyReply = async (publicKey: string, fields: SignedFields & { sig?: string }): Promise<boolean> => {
    if (!fields.sig) return false;
    try {
        let key = verifiers.get(publicKey);
        if (!key) {
            key = crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: publicKey }, { name: 'Ed25519' }, false, ['verify']);
            verifiers.set(publicKey, key);
        }
        return await crypto.subtle.verify({ name: 'Ed25519' }, await key, fromBase64Url(fields.sig), signedPayload(fields));
    } catch {
        return false;
    }
};

/**
 * Whether a message in a bot's name should be believed as the bot's own.
 * Messages from before postedBy existed are left alone: they predate the
 * signatures and cannot carry one.
 */
export const needsSignature = (m: { postedBy?: string, authorId: string }, botIds: Set<string>): boolean =>
    Boolean(m.postedBy) && botIds.has(m.authorId);
