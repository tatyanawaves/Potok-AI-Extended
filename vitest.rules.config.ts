import { defineConfig } from 'vitest/config';

/**
 * The security rules suite, run against the Firestore emulator by
 * `npm run test:rules`, which starts and stops it.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/rules/**/*.test.ts'],
        // Every case is a round trip to the emulator, and the first loads the rules.
        testTimeout: 20000,
        hookTimeout: 30000
    }
});
