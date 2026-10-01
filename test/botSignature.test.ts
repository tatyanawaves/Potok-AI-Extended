import { describe, it, expect } from 'vitest';
import { ephemeralSigningKey, importSigningKey, signReply, verifyReply, needsSignature } from '../services/botSignature';

const fields = { boardId: 'b', channelId: 'c', authorId: 'bot', postedBy: 'alice', timestamp: 1700000000000, content: 'Готово' };

describe('bot reply signatures', () => {
    it('verifies what the server signed, and nothing changed after', async () => {
        const { privateKey, publicKey } = await ephemeralSigningKey();
        const sig = await signReply(privateKey, fields);
        expect(await verifyReply(publicKey, { ...fields, sig })).toBe(true);
        expect(await verifyReply(publicKey, { ...fields, content: 'Готово!', sig })).toBe(false);
        expect(await verifyReply(publicKey, { ...fields, postedBy: 'mallory', sig })).toBe(false);
        expect(await verifyReply(publicKey, { ...fields })).toBe(false);
        expect(await verifyReply(publicKey, { ...fields, sig: 'garbage' })).toBe(false);
    });

    it('refuses a signature made with another key', async () => {
        const mine = await ephemeralSigningKey();
        const theirs = await ephemeralSigningKey();
        const sig = await signReply(theirs.privateKey, fields);
        expect(await verifyReply(mine.publicKey, { ...fields, sig })).toBe(false);
    });

    it('imports a PKCS#8 key and derives its public half', async () => {
        const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
        const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
        const imported = await importSigningKey(btoa(String.fromCharCode(...der)));
        const sig = await signReply(imported.privateKey, fields);
        expect(await verifyReply(imported.publicKey, { ...fields, sig })).toBe(true);
    });

    it('asks for a signature only on bot messages that carry postedBy', () => {
        const bots = new Set(['bot']);
        expect(needsSignature({ authorId: 'bot', postedBy: 'alice' }, bots)).toBe(true);
        expect(needsSignature({ authorId: 'bot' }, bots)).toBe(false);
        expect(needsSignature({ authorId: 'alice', postedBy: 'alice' }, bots)).toBe(false);
    });
});
