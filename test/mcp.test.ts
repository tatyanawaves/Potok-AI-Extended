import { describe, it, expect } from 'vitest';
import { parseSseFrames, toOpenAITools } from '../services/mcp';

describe('parseSseFrames', () => {
    it('reads a result from a single frame', () => {
        // The shape DeepWiki and Pipedream actually return.
        const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
        expect(parseSseFrames(body)).toEqual({
            jsonrpc: '2.0',
            id: 1,
            result: { tools: [] }
        });
    });

    it('reads an error frame', () => {
        const body = 'data: {"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"bad"}}\n';
        expect(parseSseFrames(body)?.error?.message).toBe('bad');
    });

    it('skips comments and keep-alives before the payload', () => {
        const body = [
            ': ping',
            'event: message',
            'data: not json at all',
            'data: {"jsonrpc":"2.0","id":3,"result":{"ok":true}}'
        ].join('\n');

        expect(parseSseFrames(body)?.result).toEqual({ ok: true });
    });

    it('ignores frames that carry neither result nor error', () => {
        // Progress notifications arrive on the same stream and must not be
        // mistaken for the response.
        const body = 'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n';
        expect(parseSseFrames(body)).toBeNull();
    });

    it('returns null for an empty body', () => {
        expect(parseSseFrames('')).toBeNull();
    });
});

describe('toOpenAITools', () => {
    it('maps an MCP tool onto the OpenAI function shape', () => {
        const schema = {
            type: 'object',
            properties: { repoName: { type: 'string' } },
            required: ['repoName']
        };

        expect(toOpenAITools([
            { name: 'ask_question', description: 'Ask about a repo', inputSchema: schema }
        ])).toEqual([
            {
                type: 'function',
                function: {
                    name: 'ask_question',
                    description: 'Ask about a repo',
                    parameters: schema
                }
            }
        ]);
    });

    it('substitutes an empty object schema when a tool declares none', () => {
        // A missing parameters field makes providers reject the whole request,
        // taking every other tool down with it.
        const [tool] = toOpenAITools([{ name: 'ping', inputSchema: undefined as any }]);
        expect(tool.function.parameters).toEqual({ type: 'object', properties: {} });
        expect(tool.function.description).toBe('');
    });
});
