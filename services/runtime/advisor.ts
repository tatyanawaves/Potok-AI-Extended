import { AISettings } from '../../types';
import { complete, extractJson } from '../llm';

/**
 * The tool advisor: before a task, the orchestrator looks at the team, at
 * every tool it could reach, and suggests what is missing — attach a tool to
 * a bot, create a new bot from a prompt, or write a custom MCP server when
 * nothing available fits.
 */

export interface AdvisorCandidate {
    id: string;
    name: string;
    description: string;
    needsConnection: boolean;
}

export interface AdvisorBot {
    name: string;
    persona: string;
    tools: string[];
}

export interface CustomMcpSpec {
    name: string;
    description: string;
    tools: Array<{ name: string, description: string, params: string }>;
}

export type Suggestion =
    | { type: 'attach', reason: string, bot: string, toolId: string }
    | { type: 'create_bot', reason: string, description: string, toolIds: string[] }
    | { type: 'custom_mcp', reason: string, spec: CustomMcpSpec };

export const advisorPrompt = (task: string, bots: AdvisorBot[], candidates: AdvisorCandidate[]): string => `TOOL_ADVISOR
You prepare a team of AI bots for a task. Decide which tools are missing.

TASK: ${task}

TEAM:
${bots.map(b => `- ${b.name}: ${b.persona.replace(/\s+/g, ' ').slice(0, 200) || 'general assistant'} | tools: ${b.tools.join(', ') || 'none'}`).join('\n') || '(no bots yet)'}

AVAILABLE TOOLS (id — name — what it does${candidates.some(c => c.needsConnection) ? ' — [sign-in] means the user must connect it once' : ''}):
${candidates.map(c => `- ${c.id} — ${c.name} — ${c.description}${c.needsConnection ? ' [sign-in]' : ''}`).join('\n')}

Suggest at most 4 changes, most useful first, only what the task really needs:
- "attach": give an existing bot one of the available tools (by id);
- "create_bot": a new bot described in one sentence, with tool ids it should get;
- "custom_mcp": only if no available tool can do something essential — a small MCP server spec (name, description, tools with name, description and parameters).
If the team already has what it needs, return an empty list. Write reasons in the language of the task.
Respond ONLY in JSON: {"suggestions": [{"type": "attach", "reason": "...", "bot": "Name", "toolId": "..."}, {"type": "create_bot", "reason": "...", "description": "...", "toolIds": ["..."]}, {"type": "custom_mcp", "reason": "...", "spec": {"name": "...", "description": "...", "tools": [{"name": "...", "description": "...", "params": "..."}]}}]}`;

/** Keeps only suggestions that point at real bots and real tools. */
export const parseAdvice = (raw: string | null, bots: AdvisorBot[], candidates: AdvisorCandidate[]): Suggestion[] => {
    const data = extractJson<{ suggestions?: any[] }>(raw);
    const ids = new Set(candidates.map(c => c.id));
    const botName = (name: unknown) => bots.find(b => b.name.toLowerCase() === String(name || '').replace(/^@/, '').toLowerCase())?.name;
    const out: Suggestion[] = [];

    for (const s of data?.suggestions || []) {
        const reason = String(s?.reason || '').trim();
        if (s?.type === 'attach' && botName(s.bot) && ids.has(s.toolId)) {
            out.push({ type: 'attach', reason, bot: botName(s.bot)!, toolId: s.toolId });
        } else if (s?.type === 'create_bot' && String(s.description || '').trim()) {
            out.push({
                type: 'create_bot', reason, description: String(s.description).trim(),
                toolIds: (Array.isArray(s.toolIds) ? s.toolIds : []).filter((id: unknown) => ids.has(String(id)))
            });
        } else if (s?.type === 'custom_mcp' && s.spec?.name && Array.isArray(s.spec.tools) && s.spec.tools.length) {
            out.push({
                type: 'custom_mcp', reason,
                spec: {
                    name: String(s.spec.name).replace(/[^\w-]/g, '-').slice(0, 40),
                    description: String(s.spec.description || ''),
                    tools: s.spec.tools.slice(0, 8).map((t: any) => ({
                        name: String(t.name || 'tool').replace(/[^\w]/g, '_'),
                        description: String(t.description || ''),
                        params: String(t.params || '')
                    }))
                }
            });
        }
    }
    return out.slice(0, 4);
};

export const adviseTools = async (
    task: string, bots: AdvisorBot[], candidates: AdvisorCandidate[], settings: AISettings
): Promise<Suggestion[]> => {
    const result = await complete({
        messages: [{ role: 'user', content: advisorPrompt(task, bots, candidates) }],
        temperature: 0.2, json: true, model: settings.memoryModel || undefined
    }, settings);
    return parseAdvice(result.content, bots, candidates);
};

/**
 * Writes a custom MCP server as a Cloudflare Worker project: the files, ready
 * to save and deploy with `npx wrangler deploy`. Its address then goes to a
 * bot like any other tool server.
 */
export const generateMcpServer = async (
    spec: CustomMcpSpec, settings: AISettings
): Promise<Array<{ path: string, content: string }>> => {
    const result = await complete({
        messages: [{
            role: 'user',
            content: `MCP_SERVER_CODE
Write a complete MCP server as a Cloudflare Worker in TypeScript, no dependencies.
Name: ${spec.name}
Purpose: ${spec.description}
Tools:
${spec.tools.map(t => `- ${t.name}: ${t.description} (params: ${t.params})`).join('\n')}

Requirements: handle POST JSON-RPC 2.0 for "initialize", "tools/list", "tools/call" (return {content:[{type:"text",text}]}, isError on failure) and answer 202 to notifications; CORS for any origin incl. OPTIONS and headers Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version; if env.API_TOKEN is set, require "Authorization: Bearer <API_TOKEN>". Put secrets in env, never in code. Implement the tools for real where a public API allows it; otherwise leave a clear TODO.
Return three files, each in its own fenced block whose info line is the file path:
\`\`\`ts src/index.ts
\`\`\`toml wrangler.toml
\`\`\`md README.md  (deploy steps: npx wrangler deploy; wrangler secret put API_TOKEN; the /mcp URL to give the bot)`
        }],
        temperature: 0.2, maxTokens: 6000
    }, settings);

    const files: Array<{ path: string, content: string }> = [];
    const re = /```\w*\s+([\w./-]+)\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(result.content || ''))) files.push({ path: `${spec.name}/${m[1]}`, content: `${m[2].trimEnd()}\n` });
    if (files.length === 0) throw new Error('Модель не вернула код сервера — попробуйте ещё раз');
    return files;
};
