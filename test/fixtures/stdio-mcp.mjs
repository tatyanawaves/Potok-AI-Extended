// A minimal MCP server over stdio, for testing scripts/mcp-bridge.mjs.
import readline from 'node:readline';

let initCount = 0;
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');

console.log('this line is not JSON and must be ignored');

readline.createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    if (m.method === 'initialize') {
        initCount++;
        return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } });
    }
    if (m.method === 'tools/list') {
        return out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'init_count', inputSchema: { type: 'object' } }] } });
    }
    if (m.method === 'tools/call') {
        const text = m.params.name === 'init_count' ? String(initCount) : JSON.stringify(m.params.arguments);
        return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } });
    }
    out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
});
