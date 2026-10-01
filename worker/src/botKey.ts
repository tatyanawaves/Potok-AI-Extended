/**
 * The key bot replies are signed with (../../services/botSignature).
 *
 * Production reads it from the BOT_SIGNING_KEY secret — a base64 PKCS#8
 * Ed25519 key, made by scripts/gen-signing-key.mjs and set with
 *   node scripts/gen-signing-key.mjs | npx wrangler secret put BOT_SIGNING_KEY
 * Test mode (FIRESTORE_EMULATOR_HOST set) makes a throwaway one per process.
 * Without either, replies go unsigned and GET /bots/key answers 404, which the
 * app reads as "signing is off" and checks nothing.
 */

import {
    importSigningKey, ephemeralSigningKey, signReply, verifyReply, type SignedFields
} from '../../services/botSignature';
import type { BoardMessage } from '../../types';

export interface BotKeyEnv {
    BOT_SIGNING_KEY?: string;
    FIRESTORE_EMULATOR_HOST?: string;
}

type Key = { privateKey: CryptoKey, publicKey: string };
let cached: Promise<Key | null> | null = null;

export const botKey = (env: BotKeyEnv): Promise<Key | null> =>
    (cached ??= (env.BOT_SIGNING_KEY
        ? importSigningKey(env.BOT_SIGNING_KEY)
        : env.FIRESTORE_EMULATOR_HOST ? ephemeralSigningKey() : Promise.resolve(null)
    ).catch(error => {
        console.error('[botKey] BOT_SIGNING_KEY is not a valid Ed25519 PKCS#8 key:', error);
        return null;
    }));

/** Signs bot replies, or nothing when no key is set. */
export const signerFor = async (env: BotKeyEnv): Promise<((fields: SignedFields) => Promise<string>) | undefined> => {
    const key = await botKey(env);
    return key ? fields => signReply(key.privateKey, fields) : undefined;
};

/** Checks bot replies, or nothing when no key is set. */
export const verifierFor = async (env: BotKeyEnv): Promise<((message: BoardMessage) => Promise<boolean>) | undefined> => {
    const key = await botKey(env);
    return key ? message => verifyReply(key.publicKey, { ...message, timestamp: message.timestamp }) : undefined;
};
