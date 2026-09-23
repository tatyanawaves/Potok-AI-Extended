import { AISettings, BoardMember, TokenUsage } from '../types';
import { addUsage, EMPTY_USAGE } from './usage';
import { sendMessage, isBot } from './boards';
import { connect, callTool, toOpenAITools, McpConnection, McpTool } from './mcp';
import { auth } from './firebase';
import { complete, ChatMessage, isFatalProviderError, modelOf, extractJson } from './llm';
import { loadTurnMemory, addNote, recallNotes } from './agentMemory';
import { memoryBlock, selectTools, clip } from './memoryCore';

export { describeHttpError, isFatalProviderError } from './llm';

/**
 * Bots in board channels: one turn of one bot, and the two ways turns are
 * started — an @mention, or a round-robin discussion. The orchestrated mode
 * lives in ./orchestrator and uses the same turn.
 *
 * A turn is: load memory (summary + relevant notes + a short window of recent
 * messages, see ./agentMemory), ask the model, run the tools it asks for, and
 * repeat until it answers in prose or runs out of tool rounds.
 */

const MAX_REPLY_LENGTH = 1500;
/** Tool output is untrusted and can be huge; cap what reaches the model. */
const MAX_TOOL_RESULT_LENGTH = 6000;

/** Rounds of tool calls allowed before the bot must answer with prose. */
export const MAX_TOOL_ROUNDS = 4;

/**
 * Most model requests one bot turn can make: a request per tool round plus the
 * final one that has to produce prose. Used to show the ceiling of a run.
 */
export const MAX_REQUESTS_PER_TURN = MAX_TOOL_ROUNDS + 1;

/**
 * How much freedom a bot has with its external tools.
 *
 *  'off'  — tools are withheld; the bot answers from knowledge and memory.
 *  'ask'  — every external call needs the operator's approval first.
 *  'auto' — the bot calls whatever it needs.
 *
 * The built-in memory tools are always allowed: they only touch the board's
 * own notes.
 */
export type ToolPolicy = 'off' | 'ask' | 'auto';

/** Asked to approve one call; returning false makes the bot work without it. */
export type ToolApprover = (
    botName: string,
    toolName: string,
    args: Record<string, any>
) => Promise<boolean>;

// --- Tool servers ---------------------------------------------------------------

const PIPEDREAM_WORKER_URL: string = (import.meta.env.VITE_PIPEDREAM_WORKER_URL || '')
    .replace(/\/$/, '');

/**
 * The bearer token for a tool server. The Pipedream bridge takes the caller's
 * Firebase ID token; every other server uses a token the user pasted in
 * Settings, which never leaves this browser.
 */
const tokenForServer = async (url: string, settings: AISettings): Promise<string | undefined> => {
    if (PIPEDREAM_WORKER_URL && url.startsWith(PIPEDREAM_WORKER_URL)) {
        return auth.currentUser?.getIdToken();
    }
    return settings.mcpTokens?.[url]?.trim() || undefined;
};

/** Handshakes are reused per URL — listing tools on every turn is wasteful. */
const connectionCache = new Map<string, McpConnection>();

const connectToToolServer = async (url: string, settings: AISettings): Promise<McpConnection> => {
    const cached = connectionCache.get(url);
    if (cached) return cached;

    const connection = await connect(url, await tokenForServer(url, settings));
    connectionCache.set(url, connection);
    return connection;
};

/** Drops cached handshakes, e.g. after a token changes. */
export const resetToolConnections = (): void => connectionCache.clear();

/** Every tool server a bot is configured with. */
export const toolServersOf = (agent: BoardMember): string[] =>
    [...new Set([agent.toolServerUrl, ...(agent.toolServerUrls || [])]
        .map(u => u?.trim())
        .filter((u): u is string => Boolean(u)))];

/**
 * Connects to a server and reports what it offers — used when creating a bot,
 * so a wrong URL or a CORS refusal shows up there, not in the middle of a task.
 */
export const probeToolServer = async (url: string, settings: AISettings): Promise<McpTool[]> => {
    connectionCache.delete(url);
    return (await connectToToolServer(url, settings)).tools;
};

// --- Built-in tools ------------------------------------------------------------

const BUILTIN_TOOLS: McpTool[] = [
    {
        name: 'memory_remember',
        description: 'Save a durable fact, decision or result to the board memory so it is available in later conversations. Use for things worth knowing next week, not for chit-chat.',
        inputSchema: {
            type: 'object',
            properties: { fact: { type: 'string', description: 'One self-contained sentence.' } },
            required: ['fact']
        }
    },
    {
        name: 'memory_recall',
        description: 'Search the board memory for facts, decisions and results saved earlier.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What to look for.' } },
            required: ['query']
        }
    }
];

const isBuiltin = (name: string) => BUILTIN_TOOLS.some(t => t.name === name);

const runBuiltin = async (
    name: string,
    args: Record<string, any>,
    ctx: { boardId: string, channelId: string, agent: BoardMember }
): Promise<string> => {
    if (name === 'memory_remember') {
        const fact = String(args.fact || '').trim();
        if (!fact) return 'Nothing to save: "fact" was empty.';
        await addNote(ctx.boardId, { text: fact, author: ctx.agent.name, channelId: ctx.channelId });
        return 'Saved to board memory.';
    }
    if (name === 'memory_recall') {
        const found = await recallNotes(ctx.boardId, String(args.query || ''), 5);
        return found.length
            ? found.map(n => `- ${n.text} (${n.author})`).join('\n')
            : 'Nothing relevant in board memory.';
    }
    return `Unknown built-in tool ${name}`;
};

// --- Prompt -------------------------------------------------------------------

/** Extra briefing given to a bot taking a turn in a round-robin discussion. */
export interface DiscussionContext {
    participants: string[];
    task: string;
    turn: number;
    totalTurns: number;
}

/** A step handed to a bot by the orchestrator. */
export interface Assignment {
    goal: string;
    instruction: string;
    step: number;
    totalSteps: number;
}

export const buildSystemPrompt = (
    agent: BoardMember,
    channelName: string,
    memory: string,
    options: { discussion?: DiscussionContext, assignment?: Assignment, externalTools?: boolean } = {}
): string => {
    const persona = agent.systemPrompt?.trim()
        || 'You are an autonomous digital consciousness participating in a team discussion.';

    const parts = [persona, `You are "${agent.name}", a participant in the #${channelName} channel of a shared board where humans and AI agents collaborate.
Reply concisely (under 150 words unless the task needs more). Do not prefix your reply with your own name.
Answer in the language the other participants use.`];

    // Bots were seen abandoning their tools after another participant claimed
    // they were broken. Trying is cheap, and a real failure comes back anyway.
    parts.push(options.externalTools
        ? `You have working tools. Call them to get real data instead of answering from memory; if someone says your tools fail, check by calling one. Never invent identifiers, numbers or names a tool could give you.
You can also save lasting facts with memory_remember and look them up with memory_recall.`
        : 'You can save lasting facts with memory_remember and look them up with memory_recall.');

    // Stable part first (persona, rules, memory), task-specific part last:
    // providers that cache prompt prefixes can then reuse most of it.
    if (memory) parts.push(memory);

    const { discussion, assignment } = options;
    if (assignment) {
        parts.push(`ORCHESTRATED TASK — step ${assignment.step} of ${assignment.totalSteps}.
Overall goal: ${assignment.goal}
YOUR ASSIGNMENT: ${assignment.instruction}
Do your assignment only, building on what the others already produced. Use tools where they give real data.
End with the concrete result of your step.`);
    } else if (discussion) {
        const others = discussion.participants.filter(name => name !== agent.name);
        const isLast = discussion.turn === discussion.totalTurns;
        // Without the turn counter every bot opened as if the topic were new.
        parts.push(`You are in a working discussion with other AI participants${others.length ? `: ${others.join(', ')}` : ''}.
GOAL: ${discussion.task}
This is turn ${discussion.turn} of ${discussion.totalTurns}.
Build on what has already been said; do not restate points or greet again. Disagree explicitly when a previous point is wrong, and say why.
${isLast
                ? 'This is the FINAL turn: close the discussion with the concrete result the goal asks for.'
                : 'Keep it moving: end with the single most useful open question or next step.'}`);
    }

    return parts.join('\n\n');
};

/**
 * The bot's text, or a visible note that there was none. Reasoning models
 * sometimes return empty content; posted as-is that was a blank message.
 */
export const replyOrNotice = (content: string | null | undefined): string => {
    const text = (content || '').trim();
    return text
        ? text.substring(0, MAX_REPLY_LENGTH)
        : '⚠️ Модель вернула пустой ответ. Попробуйте ещё раз или выберите другую модель в настройках.';
};

// --- One turn -------------------------------------------------------------------

export interface TurnOptions {
    agent: BoardMember;
    boardId: string;
    channelId: string;
    channelName: string;
    settings: AISettings;
    discussion?: DiscussionContext;
    assignment?: Assignment;
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
    onToolCall?: (toolName: string) => void;
    signal?: AbortSignal;
}

export interface TurnResult {
    reply: string;
    modelName: string;
    toolsUsed: string[];
    usage: TokenUsage;
}

export const runBotTurn = async (options: TurnOptions): Promise<TurnResult> => {
    const {
        agent, boardId, channelId, channelName, settings,
        discussion, assignment, toolPolicy = 'auto', approveTool, onToolCall, signal
    } = options;

    const focus = assignment?.instruction || discussion?.task || '';
    const memory = await loadTurnMemory(boardId, channelId, settings, focus);

    // Connect every server; a dead one must not silence the bot.
    const toolOwner = new Map<string, McpConnection>();
    const available: McpTool[] = [...BUILTIN_TOOLS];
    const notes: string[] = [];

    if (toolPolicy !== 'off') {
        for (const url of toolServersOf(agent)) {
            try {
                const connection = await connectToToolServer(url, settings);
                for (const tool of connection.tools) {
                    if (toolOwner.has(tool.name) || isBuiltin(tool.name)) continue;
                    toolOwner.set(tool.name, connection);
                    available.push(tool);
                }
            } catch (error) {
                notes.push(`Tool server ${new URL(url).host} is unavailable (${error instanceof Error ? error.message : String(error)}). Say so if the task needs it.`);
            }
        }
    }

    const offered = selectTools(available, `${focus} ${memory.latest?.content || ''}`);
    const tools = toOpenAITools(offered);

    const system = buildSystemPrompt(agent, channelName, memoryBlock(memory.summary, memory.notes), {
        discussion, assignment, externalTools: toolOwner.size > 0
    }) + (notes.length ? `\n\n${notes.join('\n')}` : '');

    const messages: ChatMessage[] = [{ role: 'system', content: system }];
    for (const msg of memory.window) {
        messages.push(msg.authorId === agent.id
            ? { role: 'assistant', content: msg.content }
            : { role: 'user', content: `${msg.authorName}: ${msg.content}` });
    }
    // Some providers refuse a conversation that ends on the assistant.
    if (messages[messages.length - 1].role !== 'user') {
        messages.push({ role: 'user', content: assignment ? 'Proceed with your assignment.' : 'Continue.' });
    }

    const model = agent.model || modelOf(settings);
    const toolsUsed: string[] = [];
    // The same call with the same arguments inside one turn is answered from
    // here: models repeat lookups, and the answer has not changed.
    const resultCache = new Map<string, string>();
    let usage = EMPTY_USAGE;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // Final round without tools, so the model has to answer in prose.
        const offer = round < MAX_TOOL_ROUNDS ? tools : undefined;
        const completion = await complete({ messages, tools: offer, model, temperature: 0.8, signal }, settings);
        usage = addUsage(usage, completion.usage);

        if (completion.toolCalls.length === 0 || !offer) {
            return { reply: replyOrNotice(completion.content), modelName: completion.model, toolsUsed, usage };
        }

        messages.push({
            role: 'assistant',
            content: completion.content,
            tool_calls: completion.toolCalls.map(call => ({
                id: call.id, type: 'function', function: { name: call.name, arguments: call.args }
            }))
        });

        const execute = async (call: { id: string, name: string, args: string }): Promise<ChatMessage> => {
            let args: Record<string, any>;
            try {
                args = JSON.parse(call.args || '{}');
            } catch {
                return { role: 'tool', tool_call_id: call.id, content: 'Error: arguments were not valid JSON. Retry with valid JSON.' };
            }

            const key = `${call.name}:${JSON.stringify(args)}`;
            if (resultCache.has(key)) {
                return { role: 'tool', tool_call_id: call.id, content: resultCache.get(key)! };
            }

            let result: string;
            try {
                if (isBuiltin(call.name)) {
                    result = await runBuiltin(call.name, args, { boardId, channelId, agent });
                } else {
                    const connection = toolOwner.get(call.name);
                    if (!connection) {
                        result = `Error: no tool named ${call.name}. Available: ${offered.map(t => t.name).join(', ')}`;
                    } else {
                        if (toolPolicy === 'ask' && approveTool && !(await approveTool(agent.name, call.name, args))) {
                            return { role: 'tool', tool_call_id: call.id, content: 'The operator declined this tool call. Continue without it and say so.' };
                        }
                        onToolCall?.(call.name);
                        result = await callTool(connection, call.name, args, await tokenForServer(connection.url, settings));
                    }
                }
                if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
            } catch (error) {
                // Returned to the model, not thrown: it can retry or explain.
                result = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }

            result = clip(result, MAX_TOOL_RESULT_LENGTH);
            resultCache.set(key, result);
            return { role: 'tool', tool_call_id: call.id, content: result };
        };

        // Independent calls of one round run together — unless each needs a
        // yes from the operator, who can answer only one dialog at a time.
        const results = toolPolicy === 'ask'
            ? await completion.toolCalls.reduce<Promise<ChatMessage[]>>(
                async (acc, call) => [...await acc, await execute(call)], Promise.resolve([]))
            : await Promise.all(completion.toolCalls.map(execute));

        messages.push(...results);
    }

    return { reply: replyOrNotice(null), modelName: model, toolsUsed, usage };
};

/** Posts a finished turn to the channel. */
const postTurn = (boardId: string, channelId: string, agent: BoardMember, result: TurnResult) =>
    sendMessage({
        channelId,
        boardId,
        authorId: agent.id,
        authorName: agent.name,
        authorType: 'agent',
        content: result.reply,
        isAgentReply: true,
        modelName: result.modelName,
        toolsUsed: result.toolsUsed.length ? result.toolsUsed : undefined,
        tokensUsed: result.usage.totalTokens || undefined
    });

const postFailure = (boardId: string, channelId: string, agent: BoardMember, error: unknown, settings: AISettings) =>
    sendMessage({
        channelId,
        boardId,
        authorId: agent.id,
        authorName: agent.name,
        authorType: 'agent',
        content: `⚠️ ${agent.name} не смог ответить: ${error instanceof Error ? error.message : String(error)}`,
        isAgentReply: true,
        modelName: agent.model || modelOf(settings)
    });

export interface TurnSummary {
    bot: string;
    ok: boolean;
    result?: TurnResult;
    error?: string;
}

/**
 * Runs one turn and posts it; a failure is posted instead of the reply.
 * Shared by mentions, discussions and the orchestrator.
 */
export const runAndPostTurn = async (options: TurnOptions): Promise<TurnSummary> => {
    const { agent, boardId, channelId, settings } = options;
    try {
        const result = await runBotTurn(options);
        await postTurn(boardId, channelId, agent, result);
        return { bot: agent.name, ok: true, result };
    } catch (error) {
        if ((error as any)?.name === 'AbortError') throw error;
        console.error(`[BoardAgent] ${agent.name} failed:`, error);
        await postFailure(boardId, channelId, agent, error, settings);
        return { bot: agent.name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

// --- Mentions -----------------------------------------------------------------

/**
 * Answers every bot the message mentions, in order, each seeing the previous
 * reply. Runs in the mentioning user's browser, on their key.
 */
export const triggerAgentReplies = async (
    mentions: string[],
    authorId: string,
    channelId: string,
    boardId: string,
    channelName: string,
    members: BoardMember[],
    settings: AISettings,
    toolPolicy: ToolPolicy = 'auto',
    approveTool?: ToolApprover
): Promise<void> => {
    const mentioned = members.filter(m =>
        isBot(m) && m.id !== authorId &&
        mentions.some(name => name.toLowerCase() === m.name.toLowerCase())
    );

    for (const agent of mentioned) {
        const outcome = await runAndPostTurn({ agent, boardId, channelId, channelName, settings, toolPolicy, approveTool });
        if (!outcome.ok && isFatalProviderError(outcome.error)) return;
    }
};

// --- Round-robin discussion -----------------------------------------------------

/** Bounds on a discussion run, so one click can't spend an unbounded amount. */
export const MAX_DISCUSSION_BOTS = 4;
export const MAX_DISCUSSION_ROUNDS = 6;

export interface DiscussionOptions {
    boardId: string;
    channelId: string;
    channelName: string;
    bots: BoardMember[];
    task: string;
    rounds: number;
    settings: AISettings;
    onTurn?: (turn: number, totalTurns: number, botName: string) => void;
    shouldStop?: () => boolean;
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
}

/**
 * Each bot speaks once per round, in order, seeing everything said before it.
 * The number of turns is fixed up front, so the cost is known before it runs.
 */
export const runBotDiscussion = async (options: DiscussionOptions): Promise<void> => {
    const {
        boardId, channelId, channelName, bots, task,
        rounds, settings, onTurn, shouldStop,
        toolPolicy = 'ask', approveTool
    } = options;

    const participants = bots.slice(0, MAX_DISCUSSION_BOTS);
    const totalRounds = Math.min(Math.max(rounds, 1), MAX_DISCUSSION_ROUNDS);
    if (participants.length === 0) throw new Error('Pick at least one bot');

    const names = participants.map(b => b.name);
    const totalTurns = participants.length * totalRounds;
    let turn = 0;

    for (let round = 0; round < totalRounds; round++) {
        for (const bot of participants) {
            if (shouldStop?.()) return;
            turn++;
            onTurn?.(turn, totalTurns, bot.name);

            const outcome = await runAndPostTurn({
                agent: bot, boardId, channelId, channelName, settings,
                discussion: { participants: names, task, turn, totalTurns },
                toolPolicy, approveTool
            });
            // A bad key or missing model fails every later turn the same way.
            if (!outcome.ok && isFatalProviderError(outcome.error)) return;
        }
    }
};

// --- Designing a bot from a description ------------------------------------------

export interface BotDesign {
    name: string;
    systemPrompt: string;
    /** What kind of tools the bot would need, in words, for the person to pick. */
    toolHint: string;
}

/**
 * Turns "a bot that watches our GitHub and summarises new issues" into a name
 * and a proper system prompt. A good persona prompt is most of what makes a
 * bot useful, and few people write one from scratch.
 */
export const designBot = async (description: string, settings: AISettings): Promise<BotDesign> => {
    const result = await complete({
        messages: [{
            role: 'user',
            content: `BOT_DESIGN
Design an AI bot for a team chat from this description:
"${description.trim()}"

Write:
- name: one word, letters/digits/underscore only, no spaces (it is used as @name);
- systemPrompt: 80-200 words, second person ("You are…"): role, what it does, how it works step by step, what it must not do, the tone and answer format; in the language of the description;
- toolHint: one short sentence on which external tools/services it needs, or "none".
Respond ONLY in JSON: {"name": "...", "systemPrompt": "...", "toolHint": "..."}`
        }],
        temperature: 0.5,
        json: true,
        model: settings.memoryModel || undefined
    }, settings);

    const data = extractJson<Partial<BotDesign>>(result.content);
    if (!data?.systemPrompt) throw new Error('Модель не вернула описание бота — попробуйте ещё раз');

    return {
        name: String(data.name || 'Bot').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24) || 'Bot',
        systemPrompt: String(data.systemPrompt).trim(),
        toolHint: String(data.toolHint || '').trim()
    };
};
