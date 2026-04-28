#!/usr/bin/env node
import { neonDevRestart, neonDevStart, neonDevStatus, neonDevStop } from "./neon-dev-control.mjs";

let buffer = Buffer.alloc(0);

const tools = [
  {
    name: "neon_dev_status",
    description: "Check NEON local frontend/backend dev process and port status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "neon_dev_start",
    description: "Start NEON frontend and backend dev services with stable Node-based process control.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        services: {
          type: "array",
          items: { type: "string", enum: ["frontend", "backend"] },
          description: "Optional subset of services to start.",
        },
        forcePorts: {
          type: "boolean",
          description: "Stop existing listeners on NEON dev ports before starting.",
          default: false,
        },
      },
    },
  },
  {
    name: "neon_dev_stop",
    description: "Stop NEON dev services that were started by the NEON dev controller.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        services: {
          type: "array",
          items: { type: "string", enum: ["frontend", "backend"] },
          description: "Optional subset of services to stop.",
        },
        forcePorts: {
          type: "boolean",
          description: "Also stop current listeners on NEON dev ports.",
          default: false,
        },
      },
    },
  },
  {
    name: "neon_dev_restart",
    description: "Restart NEON frontend and backend dev services.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        services: {
          type: "array",
          items: { type: "string", enum: ["frontend", "backend"] },
          description: "Optional subset of services to restart.",
        },
        forcePorts: {
          type: "boolean",
          description: "Stop existing listeners on NEON dev ports before starting.",
          default: true,
        },
      },
    },
  },
];

const send = (message) => {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
};

const textResult = (id, value, isError = false) => {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        },
      ],
      isError,
    },
  });
};

const errorResult = (id, error) => {
  textResult(id, error instanceof Error ? error.message : String(error), true);
};

const callTool = async (name, args = {}) => {
  if (name === "neon_dev_status") return neonDevStatus();
  if (name === "neon_dev_start") return neonDevStart(args);
  if (name === "neon_dev_stop") return neonDevStop(args);
  if (name === "neon_dev_restart") return neonDevRestart(args);
  throw new Error(`Unknown tool: ${name}`);
};

const handleMessage = async (message) => {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "neon-dev-control",
          version: "0.1.0",
        },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools },
    });
    return;
  }

  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      textResult(message.id, result);
    } catch (error) {
      errorResult(message.id, error);
    }
    return;
  }

  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32601,
        message: `Method not found: ${message.method}`,
      },
    });
  }
};

const parseBuffer = () => {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = Buffer.alloc(0);
      return;
    }

    const length = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) return;

    const rawMessage = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);

    try {
      void handleMessage(JSON.parse(rawMessage));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
};

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  parseBuffer();
});
