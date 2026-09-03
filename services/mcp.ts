/**
 * Minimal MCP (Model Context Protocol) client over Streamable HTTP.
 *
 * Hand-rolled rather than using @modelcontextprotocol/sdk: this runs in the
 * browser with no backend, so it has to degrade gracefully when a server does
 * not expose Mcp-Session-Id to script (a CORS response header has to be listed
 * in Access-Control-Expose-Headers to be readable, and most servers don't).
 * The official transport treats a missing session id as a hard error.
 *
 * Only servers that send permissive CORS headers can be reached at all. Known
 * to work at the time of writing: mcp.deepwiki.com, api.githubcopilot.com/mcp,
 * mcp.linear.app. Zapier and Composio do not allow browser origins and need a
 * server-side proxy.
 */

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'potok', version: '1.0.0' };

export interface McpTool {
    name: string;
    description?: string;
    inputSchema: Record<string, any>;
}

export interface McpConnection {
    url: string;
    sessionId: string | null;
    tools: McpTool[];
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id?: number | string;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

let nextId = 1;

/**
 * Streamable HTTP allows a JSON body or an SSE stream for the same request.
 * Reads whichever came back and returns the first JSON-RPC response in it.
 */
const readResponse = async (response: Response): Promise<JsonRpcResponse | null> => {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
        const text = await response.text();

        for (const line of text.split('\n')) {
            if (!line.startsWith('data:')) continue;

            try {
                const payload = JSON.parse(line.slice(5).trim());
                if (payload && (payload.result !== undefined || payload.error !== undefined)) {
                    return payload as JsonRpcResponse;
                }
            } catch {
                // Keep-alive comments and partial frames are expected here.
            }
        }

        return null;
    }

    if (!contentType.includes('application/json')) return null;
    return response.json();
};

const rpc = async (
    url: string,
    method: string,
    params: Record<string, any> | undefined,
    sessionId: string | null,
    token?: string,
    isNotification = false
): Promise<any> => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION
    };

    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body: Record<string, any> = { jsonrpc: '2.0', method };
    if (params) body.params = params;
    if (!isNotification) body.id = nextId++;

    let response: Response;
    try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (error) {
        // A CORS rejection surfaces here as an opaque TypeError.
        throw new Error(
            `Не удалось связаться с MCP-сервером. Возможно, он не разрешает запросы из браузера (CORS): ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (!response.ok) {
        throw new Error(`MCP ${method}: HTTP ${response.status} ${await response.text().catch(() => '')}`.trim());
    }

    if (isNotification) return null;

    const payload = await readResponse(response);
    if (!payload) throw new Error(`MCP ${method}: пустой ответ`);
    if (payload.error) throw new Error(`MCP ${method}: ${payload.error.message}`);

    return payload.result;
};

/** Handshakes with the server and lists what it can do. */
export const connect = async (url: string, token?: string): Promise<McpConnection> => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const initBody = {
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO
        }
    };

    let response: Response;
    try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(initBody) });
    } catch (error) {
        throw new Error(
            `Не удалось связаться с MCP-сервером. Возможно, он не разрешает запросы из браузера (CORS): ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (!response.ok) {
        throw new Error(`MCP initialize: HTTP ${response.status}`);
    }

    const init = await readResponse(response);
    if (!init || init.error) {
        throw new Error(`MCP initialize: ${init?.error?.message || 'пустой ответ'}`);
    }

    // Readable only when the server lists it in Access-Control-Expose-Headers;
    // servers that keep it hidden are generally stateless and work without it.
    const sessionId = response.headers.get('mcp-session-id');

    await rpc(url, 'notifications/initialized', undefined, sessionId, token, true)
        .catch(() => { /* Optional for stateless servers. */ });

    const listed = await rpc(url, 'tools/list', {}, sessionId, token);

    return {
        url,
        sessionId,
        tools: (listed?.tools || []) as McpTool[]
    };
};

/** Runs one tool and flattens the result into text for the model. */
export const callTool = async (
    connection: McpConnection,
    name: string,
    args: Record<string, any>,
    token?: string
): Promise<string> => {
    const result = await rpc(
        connection.url,
        'tools/call',
        { name, arguments: args },
        connection.sessionId,
        token
    );

    if (result?.isError) {
        const detail = (result.content || [])
            .map((part: any) => part?.text || '')
            .join('\n')
            .trim();
        throw new Error(detail || 'Инструмент вернул ошибку');
    }

    const text = (result?.content || [])
        .map((part: any) => {
            if (part?.type === 'text') return part.text;
            if (part?.type === 'resource') return part.resource?.text || '';
            return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();

    return text || JSON.stringify(result?.structuredContent ?? result ?? {});
};

/** Converts MCP tool definitions into the OpenAI `tools` parameter shape. */
export const toOpenAITools = (tools: McpTool[]) =>
    tools.map(tool => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
    }));
