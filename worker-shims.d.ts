/**
 * The app's type check also reads worker/src/index.ts (the tests import it),
 * which lazily loads this package. It is installed only in worker/, so a
 * checkout that ran `npm ci` at the root alone would fail on it. The worker's
 * own tsconfig never sees this file and keeps the real types.
 */
declare module '@cloudflare/puppeteer';
