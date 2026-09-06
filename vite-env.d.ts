/// <reference types="vite/client" />

/**
 * The environment variables this app reads.
 *
 * Vite's own ImportMetaEnv carries an index signature, so these would be
 * reachable without declaring them — but as `any`. Listing them here types
 * each one as a string and documents, in code, the full set the client
 * depends on. Their meanings are in .env.example.
 */
interface ImportMetaEnv {
    /** Deployed URL of worker/, the Pipedream Connect bridge. */
    readonly VITE_PIPEDREAM_WORKER_URL?: string;

    /**
     * Build-time fallback provider keys. Anything here ships inside the client
     * bundle and is visible to every visitor; per-user keys entered in
     * Settings are the safe path.
     */
    readonly VITE_OPENROUTER_API_KEY?: string;
    readonly VITE_GROQ_API_KEY?: string;
    readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
