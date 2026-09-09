import { describe, it, expect } from 'vitest';
import { corsHeaders, type Env } from '../worker/src/index';

const env = {
    ALLOWED_ORIGINS: 'http://localhost:3001,https://neon-extended.web.app'
} as Env;

describe('corsHeaders', () => {
    it('reflects an allowed origin', () => {
        expect(corsHeaders(env, 'https://neon-extended.web.app')['Access-Control-Allow-Origin'])
            .toBe('https://neon-extended.web.app');
    });

    it('does not reflect an origin that is not on the list', () => {
        expect(corsHeaders(env, 'https://evil.example')['Access-Control-Allow-Origin'])
            .not.toBe('https://evil.example');
    });

    it('allows the headers the MCP client sends', () => {
        // Regression: only Content-Type and Authorization were allowed, so the
        // preflight rejected every tools/list and it surfaced in the browser as
        // an opaque "Failed to fetch" with no clue as to the cause.
        const allowed = corsHeaders(env, 'http://localhost:3001')['Access-Control-Allow-Headers'];

        for (const header of ['Content-Type', 'Authorization', 'MCP-Protocol-Version', 'Mcp-Session-Id']) {
            expect(allowed).toContain(header);
        }
    });

    it('exposes the session header to script', () => {
        // A response header is unreadable from JS unless it is listed here.
        expect(corsHeaders(env, 'http://localhost:3001')['Access-Control-Expose-Headers'])
            .toContain('Mcp-Session-Id');
    });

    it('varies on Origin so a reflected value is never cached for everyone', () => {
        expect(corsHeaders(env, 'http://localhost:3001').Vary).toBe('Origin');
    });
});
