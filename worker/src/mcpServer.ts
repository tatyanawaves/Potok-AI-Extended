/**
 * A minimal MCP server over Streamable HTTP, for tools this worker provides
 * itself (the cloud browser, code sandboxes). Stateless: every request is a
 * complete JSON-RPC call, answered with JSON, which is all the browser client
 * in services/mcp.ts needs.
 */

export interface ServerTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run(args: Record<string, any>): Promise<string>;
}

export const handleMcpRequest = async (
    request: Request,
    serverName: string,
    tools: ServerTool[],
    headers: Record<string, string>
): Promise<Response> => {
    const reply = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json', 'Mcp-Session-Id': serverName }
    });

    let rpc: any;
    try {
        rpc = await request.json();
    } catch {
        return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }

    // Notifications need no answer.
    if (rpc.id === undefined) return reply(null, 202);
    const result = (value: unknown) => reply({ jsonrpc: '2.0', id: rpc.id, result: value });

    switch (rpc.method) {
        case 'initialize':
            return result({
                protocolVersion: rpc.params?.protocolVersion || '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: serverName, version: '1.0.0' }
            });
        case 'tools/list':
            return result({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
            const tool = tools.find(t => t.name === rpc.params?.name);
            if (!tool) return result({ isError: true, content: [{ type: 'text', text: `Unknown tool ${rpc.params?.name}` }] });
            try {
                return result({ content: [{ type: 'text', text: await tool.run(rpc.params?.arguments || {}) }] });
            } catch (error) {
                return result({ isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] });
            }
        }
        case 'ping':
            return result({});
        default:
            return reply({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown method ${rpc.method}` } });
    }
};
