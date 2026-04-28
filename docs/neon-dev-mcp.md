# NEON dev MCP

This repository includes a local MCP server for stable NEON dev startup.

## Tools

- `neon_dev_status`: inspect frontend/backend ports, pid files, URLs, and logs.
- `neon_dev_start`: start frontend and backend without PowerShell `Start-Process`.
- `neon_dev_stop`: stop processes started by the dev controller.
- `neon_dev_restart`: restart both services and optionally clear occupied NEON dev ports.

The MCP server is declared in `.mcp.json`:

```json
{
  "mcpServers": {
    "neon-dev": {
      "command": "node",
      "args": ["scripts/neon-dev-mcp.mjs"],
      "cwd": "."
    }
  }
}
```

Codex Desktop may need to reload the workspace before these tools appear.

## CLI fallback

Use the same controller without MCP:

```bash
npm run dev:status
npm run dev:all
npm run dev:restart
npm run dev:stop
```

Runtime pid files and logs are written to `.neon-runtime/`, which is ignored by git.
