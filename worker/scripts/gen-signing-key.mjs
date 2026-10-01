// Prints a new Ed25519 private key (base64 PKCS#8) for signing bot replies.
// Pipe it straight into the worker's secrets, so it is never shown or saved:
//   node scripts/gen-signing-key.mjs | npx wrangler secret put BOT_SIGNING_KEY
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
process.stdout.write(Buffer.from(der).toString('base64'));
