import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // The app's modules initialise Firebase at import time, which cannot
        // run here; suites that touch them mock ./services/firebase.
        setupFiles: [],
        coverage: {
            provider: 'v8',
            include: ['services/**/*.ts'],
            reporter: ['text', 'html']
        }
    },
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') }
    }
});
