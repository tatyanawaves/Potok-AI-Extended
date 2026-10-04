import type { ToolCall } from './llm';

/**
 * Tool calls a model wrote as text instead of using the API's tool_calls.
 *
 * Some open models served through OpenRouter (Qwen-, Nemotron- and
 * Hermes-style templates) sometimes print their call into the reply:
 *
 *   <tool_call><function=write_file><parameter=path>~/a.csv</parameter>…</function></tool_call>
 *   <tool_call>{"name": "write_file", "arguments": {"path": "~/a.csv"}}</tool_call>
 *
 * Left alone, the person sees that markup as the bot's answer and the work
 * stops there. Only names among the tools offered this turn are taken, so
 * this never reaches a tool the model was not given anyway.
 */

const BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/** A parameter's text as a value: JSON when it is a number, flag, list or object, else the text. */
const valueOf = (raw: string): unknown => {
    const text = raw.replace(/^\n/, '').replace(/\n$/, '');
    const trimmed = text.trim();
    if (/^(-?\d+(\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(trimmed)) {
        try { return JSON.parse(trimmed); } catch { /* text after all */ }
    }
    return text;
};

const parseBlock = (body: string): { name: string, args: Record<string, unknown> } | null => {
    const xml = /<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/.exec(body);
    if (xml) {
        const args: Record<string, unknown> = {};
        for (const m of xml[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) args[m[1]] = valueOf(m[2]);
        return { name: xml[1], args };
    }
    try {
        const json = JSON.parse(body);
        if (json && typeof json.name === 'string') {
            const args = typeof json.arguments === 'string' ? JSON.parse(json.arguments) : json.arguments || json.parameters || {};
            return { name: json.name, args };
        }
    } catch { /* not JSON */ }
    return null;
};

/**
 * The calls written as text in `content` for tools in `offered`, and the
 * content without them. No calls: content unchanged.
 */
export const textToolCalls = (content: string | null, offered: Set<string>): { calls: ToolCall[], rest: string | null } => {
    if (!content || !content.includes('<tool_call>')) return { calls: [], rest: content };
    const calls: ToolCall[] = [];
    const rest = content.replace(BLOCK, (whole, body: string) => {
        const call = parseBlock(body);
        if (!call || !offered.has(call.name)) return whole;
        calls.push({ id: `text_call_${calls.length + 1}`, name: call.name, args: JSON.stringify(call.args) });
        return '';
    }).trim();
    return calls.length ? { calls, rest: rest || null } : { calls: [], rest: content };
};
