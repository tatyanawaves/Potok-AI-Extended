import { AISettings, BoardMember, TokenUsage } from '../../types';
import { addUsage, EMPTY_USAGE } from '../usage';
import { connect, callTool, toOpenAITools, McpConnection, McpTool } from '../mcp';
import { complete, ChatMessage, isFatalProviderError, modelOf, extractJson } from '../llm';
import { memoryBlock, selectTools, clip } from '../memoryCore';
import { isBot, mentionableName } from '../mentions';
import { AgentStore } from './store';
import { loadTurnMemory, fileNote, findNotes } from './memory';

/**
 * One turn of one bot, and the two ways turns are started — an @mention and a
 * round-robin discussion. The orchestrated mode (./orchestrate) uses the same
 * turn. Platform-free: storage comes in as an AgentStore.
 *
 * A turn is: load memory (summary + relevant notes + a short window), ask the
 * model, run the tools it asks for, repeat until it answers in prose or runs
 * out of tool rounds.
 */

/**
 * Longest reply posted. It used to be 1500 characters, which silently cut
 * code, tables and reports in half — the step "succeeded" and the orchestrator
 * built on the stump. A message this long is still far from Firestore's limit.
 */
const MAX_REPLY_LENGTH = 8000;
const TRUNCATION_NOTE = '\n\n…(ответ обрезан — попросите бота продолжить)';
/** Tool output is untrusted and can be huge; cap what reaches the model. */
const MAX_TOOL_RESULT_LENGTH = 6000;

/** Rounds of tool calls allowed before the bot must answer with prose. */
export const MAX_TOOL_ROUNDS = 4;
/** Most model requests one turn can make: one per tool round plus the answer. */
export const MAX_REQUESTS_PER_TURN = MAX_TOOL_ROUNDS + 1;

/**
 * How much freedom a bot has with external tools: withheld, each call
 * approved by a person, or free. The built-in memory tools are always allowed.
 */
export type ToolPolicy = 'off' | 'ask' | 'auto';

export type ToolApprover = (botName: string, toolName: string, args: Record<string, any>) => Promise<boolean>;

// --- Tool servers ---------------------------------------------------------------

/**
 * Handshakes are reused — listing tools on every turn is wasteful — but per
 * URL *and* token. Keyed by URL alone, a server task in the worker reused
 * another user's session (and their tool list) on the same shared address,
 * such as the OAuth proxy, and a browser kept the previous account's session
 * after signing in as someone else.
 */
const connectionCache = new Map<string, McpConnection>();
const MAX_CACHED_CONNECTIONS = 64;
const cacheKey = (url: string, token: string | undefined, scope: string | undefined) =>
    `${url}\u0000${scope || ''}\u0000${token || ''}`;

const forgetConnections = (url: string): void => {
    for (const key of [...connectionCache.keys()]) {
        if (key.startsWith(`${url}\u0000`)) connectionCache.delete(key);
    }
};

const connectToToolServer = async (url: string, store: AgentStore): Promise<McpConnection> => {
    const token = await store.toolToken(url);
    const key = cacheKey(url, token, store.scope);
    const cached = connectionCache.get(key);
    if (cached) return cached;
    const connection = await connect(url, token);
    // Tokens that rotate (Firebase ID tokens do, hourly) leave old entries behind.
    if (connectionCache.size >= MAX_CACHED_CONNECTIONS) connectionCache.clear();
    connectionCache.set(key, connection);
    return connection;
};

/** Drops cached handshakes, e.g. after a token changes. */
export const resetToolConnections = (): void => connectionCache.clear();

/**
 * A server that forgot our session answers 404 to it (some say 400 "no valid
 * session"); the MCP spec says to start a new one. Without this every call
 * failed until the page reloaded. Only protocol-level refusals count — the
 * tool never ran, so calling it again is safe. An error from the tool itself
 * (no "MCP tools/call:" prefix) is never retried: it may have done something.
 */
const sessionLost = (connection: McpConnection, error: unknown): boolean =>
    Boolean(connection.sessionId)
    && /^MCP tools\/call: (HTTP 404\b|.*session)/i.test(error instanceof Error ? error.message : String(error));

const callWithReconnect = async (
    connection: McpConnection, name: string, args: Record<string, any>, store: AgentStore
): Promise<string> => {
    try {
        return await callTool(connection, name, args, await store.toolToken(connection.url));
    } catch (error) {
        if (!sessionLost(connection, error)) throw error;
        forgetConnections(connection.url);
        const fresh = await connectToToolServer(connection.url, store);
        return callTool(fresh, name, args, await store.toolToken(fresh.url));
    }
};

/**
 * Tools that can destroy something. MCP servers may say so themselves
 * (`destructiveHint`); most do not, so the name is read too. Asked about even
 * under the "auto" policy when someone is there to answer — an @mention has
 * no policy picker, and deleting a service should not hang on a guess.
 */
const DESTRUCTIVE_WORDS = new Set(['delete', 'remove', 'destroy', 'drop', 'purge', 'wipe', 'erase', 'terminate', 'truncate', 'unsafe', 'kill', 'revoke']);

export const isDestructiveTool = (tool: McpTool): boolean => {
    if (tool.annotations?.destructiveHint === true) return true;
    if (tool.annotations?.readOnlyHint === true) return false;
    const words = tool.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z]+/);
    return words.some(w => DESTRUCTIVE_WORDS.has(w));
};

/** Every tool server a bot is configured with. */
export const toolServersOf = (agent: BoardMember): string[] =>
    [...new Set([agent.toolServerUrl, ...(agent.toolServerUrls || [])]
        .map(u => u?.trim())
        .filter((u): u is string => Boolean(u)))];

/** Connects afresh and lists what a server offers. */
export const probeToolServer = async (url: string, store: AgentStore): Promise<McpTool[]> => {
    forgetConnections(url);
    return (await connectToToolServer(url, store)).tools;
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
        description: 'Search the board memory by meaning for facts, decisions and results saved earlier.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What to look for.' } },
            required: ['query']
        }
    }
];

/**
 * Offered only inside an orchestrated task. Some work takes minutes — a video
 * render, a long build — and a bot that polls in a loop burns its tool rounds
 * and the user's tokens. It says how long to wait instead; the orchestrator
 * pauses (a durable sleep on the server) and gives the same step back.
 */
const WAIT_TOOL: McpTool = {
    name: 'wait_and_resume',
    description: 'Pause this step and continue it later — use when a job you started (video/image generation, a build, a long export) needs minutes to finish. Say what to check when you resume.',
    inputSchema: {
        type: 'object',
        properties: {
            seconds: { type: 'number', description: 'How long to wait, 30 to 1800.' },
            note: { type: 'string', description: 'What to check on resume, with any job ids.' }
        },
        required: ['seconds', 'note']
    }
};

export const MIN_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 1800;

const isBuiltin = (name: string) => name === WAIT_TOOL.name || BUILTIN_TOOLS.some(t => t.name === name);

// --- Prompt -------------------------------------------------------------------

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
    /**
     * Results of the steps this one depends on. Passed explicitly: with steps
     * running in parallel they may no longer sit in the last few messages.
     */
    inputs?: Array<{ bot: string, result: string, failed?: boolean }>;
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
        const inputs = assignment.inputs?.length
            ? `\nRESULTS YOU BUILD ON:\n${assignment.inputs.map(i => i.failed
                ? `— ${i.bot}: (this step FAILED: ${i.result}) — do not invent its data; work with what you have and say what is missing`
                : `— ${i.bot}: ${i.result}`).join('\n')}`
            : '';
        parts.push(`ORCHESTRATED TASK — step ${assignment.step} of ${assignment.totalSteps}.
Overall goal: ${assignment.goal}
YOUR ASSIGNMENT: ${assignment.instruction}${inputs}
Do your assignment only. Use tools where they give real data.
End with the concrete result of your step.`);
    } else if (discussion) {
        const others = discussion.participants.filter(name => name !== agent.name);
        const isLast = discussion.turn === discussion.totalTurns;
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

/** The bot's text, or a visible note that there was none. */
export const replyOrNotice = (content: string | null | undefined): string => {
    const text = (content || '').trim();
    if (!text) return '⚠️ Модель вернула пустой ответ. Попробуйте ещё раз или выберите другую модель в настройках.';
    return text.length <= MAX_REPLY_LENGTH
        ? text
        : text.substring(0, MAX_REPLY_LENGTH - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
};

// --- One turn -------------------------------------------------------------------

export interface TurnOptions {
    store: AgentStore;
    agent: BoardMember;
    boardId: string;
    channelId: string;
    channelName: string;
    settings: AISettings;
    discussion?: DiscussionContext;
    assignment?: Assignment;
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
    /**
     * Under "auto", still ask before a destructive tool when approveTool is
     * given. Set for @mentions, which have no policy picker.
     */
    confirmDestructive?: boolean;
    onToolCall?: (toolName: string) => void;
    signal?: AbortSignal;
}

export interface TurnResult {
    reply: string;
    modelName: string;
    toolsUsed: string[];
    usage: TokenUsage;
    /** Set when the bot asked to pause its step and come back later. */
    wait?: { seconds: number, note: string };
}

export const runBotTurn = async (options: TurnOptions): Promise<TurnResult> => {
    const {
        store, agent, boardId, channelId, channelName, settings,
        discussion, assignment, toolPolicy = 'auto', approveTool, confirmDestructive, onToolCall, signal
    } = options;

    const focus = assignment?.instruction || discussion?.task || '';
    const memory = await loadTurnMemory(store, settings, boardId, channelId, focus);

    // Connect every server; a dead one must not silence the bot. Servers are
    // reached in parallel: one slow handshake used to delay the whole turn.
    const toolOwner = new Map<string, McpConnection>();
    const builtins: McpTool[] = assignment ? [...BUILTIN_TOOLS, WAIT_TOOL] : [...BUILTIN_TOOLS];
    const external: McpTool[] = [];
    const serverOf = new Map<McpTool, string>();
    const notes: string[] = [];

    if (toolPolicy !== 'off') {
        const urls = toolServersOf(agent);
        const connections = await Promise.allSettled(urls.map(url => connectToToolServer(url, store)));
        connections.forEach((outcome, i) => {
            if (outcome.status === 'fulfilled') {
                for (const tool of outcome.value.tools) {
                    if (toolOwner.has(tool.name) || isBuiltin(tool.name)) continue;
                    toolOwner.set(tool.name, outcome.value);
                    serverOf.set(tool, urls[i]);
                    external.push(tool);
                }
            } else {
                let host = urls[i];
                try { host = new URL(urls[i]).host; } catch { /* keep the raw url */ }
                const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
                notes.push(`Tool server ${host} is unavailable (${reason}). Say so if the task needs it.`);
            }
        });
    }

    // The built-in tools are always offered: capped together with the rest,
    // they were the first to go on a bot with many tools, and a step lost
    // wait_and_resume exactly when it had the slow jobs that need it. The cap
    // shares the remaining slots between servers instead of filling them from
    // the first one.
    const offered = [
        ...builtins,
        ...selectTools(external, `${focus} ${memory.latest?.content || ''}`, undefined, t => serverOf.get(t) || '')
    ];
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
    // A step of a task needs exact tool arguments and a faithful result more
    // than variety; a chat reply can afford more.
    const temperature = assignment ? 0.3 : 0.7;
    const toolsUsed: string[] = [];
    // The same call with the same arguments inside one turn is answered from
    // here: models repeat lookups, and the answer has not changed.
    const resultCache = new Map<string, string>();
    let usage = EMPTY_USAGE;

    const runBuiltin = async (name: string, args: Record<string, any>): Promise<string> => {
        if (name === 'memory_remember') {
            const fact = String(args.fact || '').trim();
            if (!fact) return 'Nothing to save: "fact" was empty.';
            await fileNote(store, settings, boardId, { text: fact, author: agent.name, channelId });
            return 'Saved to board memory.';
        }
        const found = await findNotes(store, settings, boardId, String(args.query || ''), 5);
        return found.length ? found.map(n => `- ${n.text} (${n.author})`).join('\n') : 'Nothing relevant in board memory.';
    };

    let waitRequest: TurnResult['wait'];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (waitRequest) {
            return {
                reply: `⏳ Жду ${waitRequest.seconds} с: ${waitRequest.note}`,
                modelName: model, toolsUsed, usage, wait: waitRequest
            };
        }

        // Final round without tools, so the model has to answer in prose.
        const offer = round < MAX_TOOL_ROUNDS ? tools : undefined;
        const completion = await complete({ messages, tools: offer, model, temperature, signal }, settings);
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
            if (resultCache.has(key)) return { role: 'tool', tool_call_id: call.id, content: resultCache.get(key)! };

            let result: string;
            let failed = false;
            try {
                if (call.name === WAIT_TOOL.name) {
                    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, Number(args.seconds) || 60));
                    waitRequest = { seconds, note: String(args.note || '').slice(0, 500) };
                    result = `Paused for ${seconds}s; you will be called again.`;
                } else if (isBuiltin(call.name)) {
                    result = await runBuiltin(call.name, args);
                } else {
                    const connection = toolOwner.get(call.name);
                    const tool = external.find(t => t.name === call.name);
                    if (!connection || !tool) {
                        // Not recorded as used: the bot only imagined it.
                        return { role: 'tool', tool_call_id: call.id, content: `Error: no tool named ${call.name}. Available: ${offered.map(t => t.name).join(', ')}` };
                    }
                    const mustAsk = toolPolicy === 'ask' || (confirmDestructive && isDestructiveTool(tool));
                    if (mustAsk && approveTool && !(await approveTool(agent.name, call.name, args))) {
                        return { role: 'tool', tool_call_id: call.id, content: 'The operator declined this tool call. Continue without it and say so.' };
                    }
                    onToolCall?.(call.name);
                    result = await callWithReconnect(connection, call.name, args, store);
                }
                if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
            } catch (error) {
                // Returned to the model, not thrown: it can retry or explain.
                result = `Error: ${error instanceof Error ? error.message : String(error)}`;
                failed = true;
            }

            result = clip(result, MAX_TOOL_RESULT_LENGTH);
            // A failure is not remembered: the retry the model is invited to
            // make would otherwise get the same error back from the cache.
            if (!failed) resultCache.set(key, result);
            return { role: 'tool', tool_call_id: call.id, content: result };
        };

        // Independent calls of one round run together — unless each needs a
        // yes from a person, who answers one dialog at a time.
        const results = toolPolicy === 'ask'
            ? await completion.toolCalls.reduce<Promise<ChatMessage[]>>(
                async (acc, call) => [...await acc, await execute(call)], Promise.resolve([]))
            : await Promise.all(completion.toolCalls.map(execute));

        messages.push(...results);
    }

    return { reply: replyOrNotice(null), modelName: model, toolsUsed, usage };
};

export interface TurnSummary {
    bot: string;
    ok: boolean;
    result?: TurnResult;
    error?: string;
}

/** Runs one turn and posts it; a failure is posted instead of the reply. */
export const runAndPostTurn = async (options: TurnOptions): Promise<TurnSummary> => {
    const { store, agent, boardId, channelId, settings } = options;
    try {
        const result = await runBotTurn(options);
        await store.postMessage({
            channelId, boardId,
            authorId: agent.id,
            authorName: agent.name,
            authorType: 'agent',
            content: result.reply,
            isAgentReply: true,
            modelName: result.modelName,
            toolsUsed: result.toolsUsed.length ? result.toolsUsed : undefined,
            tokensUsed: result.usage.totalTokens || undefined
        });
        return { bot: agent.name, ok: true, result };
    } catch (error) {
        if ((error as any)?.name === 'AbortError') throw error;
        console.error(`[Agent] ${agent.name} failed:`, error);
        await store.postMessage({
            channelId, boardId,
            authorId: agent.id,
            authorName: agent.name,
            authorType: 'agent',
            content: `⚠️ ${agent.name} не смог ответить: ${error instanceof Error ? error.message : String(error)}`,
            isAgentReply: true,
            modelName: agent.model || modelOf(settings)
        }).catch(() => { });
        return { bot: agent.name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

// --- Mentions and round-robin discussion ------------------------------------------

export interface MentionOptions {
    store: AgentStore;
    mentions: string[];
    authorId: string;
    boardId: string;
    channelId: string;
    channelName: string;
    members: BoardMember[];
    settings: AISettings;
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
    confirmDestructive?: boolean;
}

/** Answers every bot a message mentions, in order, each seeing the previous reply. */
export const answerMentions = async (options: MentionOptions): Promise<void> => {
    const { mentions, authorId, members } = options;
    const mentioned = members.filter(m =>
        isBot(m) && m.id !== authorId &&
        mentions.some(name => name.toLowerCase() === m.name.toLowerCase())
    );

    for (const agent of mentioned) {
        const outcome = await runAndPostTurn({ ...options, agent, toolPolicy: options.toolPolicy ?? 'auto' });
        if (!outcome.ok && isFatalProviderError(outcome.error)) return;
    }
};

/** Bounds on a discussion run, so one click can't spend an unbounded amount. */
export const MAX_DISCUSSION_BOTS = 4;
export const MAX_DISCUSSION_ROUNDS = 6;

export interface DiscussionOptions {
    store: AgentStore;
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

/** Each bot speaks once per round, in order; the cost is known before it runs. */
export const runBotDiscussion = async (options: DiscussionOptions): Promise<void> => {
    const { bots, task, rounds, onTurn, shouldStop, toolPolicy = 'ask' } = options;

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
                ...options, agent: bot, toolPolicy,
                discussion: { participants: names, task, turn, totalTurns }
            });
            if (!outcome.ok && isFatalProviderError(outcome.error)) return;
        }
    }
};

// --- Designing a bot from a description ------------------------------------------

export interface BotDesign {
    name: string;
    systemPrompt: string;
    toolHint: string;
}

/** Turns a one-line description into a name and a proper system prompt. */
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
        name: mentionableName(String(data.name || 'Bot')) || 'Bot',
        systemPrompt: String(data.systemPrompt).trim(),
        toolHint: String(data.toolHint || '').trim()
    };
};
