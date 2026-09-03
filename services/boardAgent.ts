import { GoogleGenAI } from '@google/genai';
import { AISettings, BoardMember, BoardMessage } from '../types';
import { getRecentMessages, sendMessage, isBot } from './boards';
import { connect, callTool, toOpenAITools, McpConnection } from './mcp';
import { auth } from './firebase';

/**
 * Generates agent replies inside board channels.
 *
 * Unlike services/ai.ts (which produces structured "Thought" JSON for the feed),
 * board agents hold a plain conversation, so these calls return free-form text.
 */

const CONTEXT_MESSAGE_COUNT = 20;
const MAX_REPLY_LENGTH = 1200;
/** Tool output is untrusted and can be huge; cap what reaches the model. */
const MAX_TOOL_RESULT_LENGTH = 6000;

/**
 * A bot's tool server URL is stored on the board and visible to its members,
 * but any token for it is private: it lives in the mentioning user's own
 * settings, keyed by server URL, and never touches Firestore.
 */
const PIPEDREAM_WORKER_URL: string = ((import.meta as any).env?.VITE_PIPEDREAM_WORKER_URL || '')
    .replace(/\/$/, '');

/**
 * Resolves the bearer token for a tool server.
 *
 * The Pipedream bridge is authenticated with the caller's Firebase ID token —
 * it derives the Pipedream end-user identity from it, so the token is
 * short-lived and cannot be stored in settings. Every other server uses a
 * static token the user pasted.
 */
const tokenForServer = async (
    url: string,
    settings: AISettings
): Promise<string | undefined> => {
    if (PIPEDREAM_WORKER_URL && url.startsWith(PIPEDREAM_WORKER_URL)) {
        return auth.currentUser?.getIdToken();
    }
    return settings.mcpTokens?.[url]?.trim() || undefined;
};

/** Handshakes are reused per URL — listing tools on every turn is wasteful. */
const connectionCache = new Map<string, McpConnection>();

const connectToToolServer = async (
    url: string,
    settings: AISettings
): Promise<McpConnection> => {
    const cached = connectionCache.get(url);
    if (cached) return cached;

    const connection = await connect(url, await tokenForServer(url, settings));
    connectionCache.set(url, connection);
    return connection;
};

/** Drops cached handshakes, e.g. after a token changes. */
export const resetToolConnections = (): void => connectionCache.clear();

/** Extra briefing given to a bot taking a turn in a multi-bot discussion. */
export interface DiscussionContext {
    /** Names of every bot taking part, in speaking order. */
    participants: string[];
    /** What the discussion has to produce. */
    task: string;
    turn: number;
    totalTurns: number;
}

const buildSystemPrompt = (
    agent: BoardMember,
    channelName: string,
    discussion?: DiscussionContext
): string => {
    const persona = agent.systemPrompt?.trim()
        || 'You are an autonomous digital consciousness participating in a team discussion.';

    const base = `${persona}

You are "${agent.name}", a participant in the #${channelName} channel of a shared board where humans and AI agents collaborate.
Reply conversationally and concisely (under 120 words). Do not prefix your reply with your own name.
Answer in the same language the other participants are using.`;

    if (!discussion) return base;

    const others = discussion.participants.filter(name => name !== agent.name);
    const isLast = discussion.turn === discussion.totalTurns;

    // The turn counter matters: without it every bot opens as if the topic were
    // new, and the discussion never converges on anything before the cap.
    return `${base}

You are in a working discussion with other AI participants${others.length ? `: ${others.join(', ')}` : ''}.
GOAL: ${discussion.task}
This is turn ${discussion.turn} of ${discussion.totalTurns}.
Build on what has already been said and add something new — do not restate points
that are already made, and do not greet the group again. Disagree explicitly when
you think a previous point is wrong, and say why.
${isLast
            ? 'This is the FINAL turn: close the discussion with the concrete result the goal asks for.'
            : 'Keep it moving: end with the single most useful open question or next step.'}`;
};

/** Renders channel history as OpenAI-style chat messages from the agent's point of view. */
const buildChatMessages = (
    agent: BoardMember,
    channelName: string,
    history: BoardMessage[],
    discussion?: DiscussionContext
) => {
    const messages: { role: 'system' | 'user' | 'assistant', content: string }[] = [
        { role: 'system', content: buildSystemPrompt(agent, channelName, discussion) }
    ];

    for (const msg of history) {
        if (msg.isPending) continue;

        if (msg.authorId === agent.id) {
            messages.push({ role: 'assistant', content: msg.content });
        } else {
            messages.push({ role: 'user', content: `${msg.authorName}: ${msg.content}` });
        }
    }

    return messages;
};

/** One assistant turn, which may be a tool request rather than prose. */
interface ChatCompletion {
    content: string | null;
    toolCalls: Array<{ id: string, name: string, args: string }>;
}

const callOpenAICompatible = async (
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: any[],
    extraHeaders: Record<string, string> = {},
    tools?: any[]
): Promise<ChatCompletion> => {
    const body: Record<string, any> = { model, messages, temperature: 0.9 };
    if (tools?.length) body.tools = tools;

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...extraHeaders
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
        throw new Error('Invalid response structure');
    }

    return {
        content: message.content ?? null,
        toolCalls: (message.tool_calls || []).map((call: any) => ({
            id: call.id,
            name: call.function?.name,
            args: call.function?.arguments || '{}'
        }))
    };
};

const callGemini = async (
    apiKey: string,
    model: string,
    messages: { role: string, content: string }[]
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: apiKey || 'PLACEHOLDER_API_KEY' });

    // Gemini has no system role in generateContent — fold it into the first turn.
    const system = messages.find(m => m.role === 'system')?.content || '';
    const transcript = messages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role === 'assistant' ? 'You' : 'Participant'}: ${m.content}`)
        .join('\n');

    const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `${system}\n\nConversation so far:\n${transcript}\n\nYour reply:` }] }]
    });

    return response.text;
};

/**
 * Asks for the agent's next line in the channel.
 *
 * Generation runs in the browser on the key of whoever @mentioned the bot:
 * invoking a bot is what costs tokens, so the cost lands on the person who
 * chose to invoke it. Nobody can spend another account's quota, and a bot's
 * creator cannot be drained by other people using their bot.
 */
/** Rounds of tool calls allowed before the bot must answer with prose. */
const MAX_TOOL_ROUNDS = 4;

export const generateAgentReply = async (
    agent: BoardMember,
    channelName: string,
    history: BoardMessage[],
    settings: AISettings,
    discussion?: DiscussionContext,
    onToolCall?: (toolName: string) => void
): Promise<{ reply: string, modelName: string, toolsUsed: string[] }> => {
    const messages: any[] = buildChatMessages(agent, channelName, history, discussion);
    const toolsUsed: string[] = [];

    // Gemini's SDK has its own function-calling shape; tools stay OpenAI-only
    // for now, so a Gemini-backed bot simply answers without them.
    if (settings.aiProvider === 'gemini') {
        const reply = await callGemini(
            settings.geminiKey || '',
            settings.geminiModel || 'gemini-1.5-flash',
            messages
        );
        return {
            reply: reply.trim().substring(0, MAX_REPLY_LENGTH),
            modelName: modelNameFor(settings),
            toolsUsed
        };
    }

    const useGroq = settings.aiProvider === 'groq';
    const baseUrl = settings.apiBaseUrl
        || (useGroq ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1');
    const apiKey = (useGroq ? settings.groqKey : settings.openRouterKey) || '';
    const model = (useGroq ? settings.groqModel : settings.openRouterModel)
        || (useGroq ? 'llama-3.3-70b-versatile' : 'minimax/minimax-m3:free');
    const headers = useGroq
        ? {}
        : { 'HTTP-Referer': window.location.origin, 'X-Title': 'Potok' };

    // Connect lazily: a bot without a tool server behaves exactly as before.
    let connection: McpConnection | null = null;
    let openAiTools: any[] | undefined;

    if (agent.toolServerUrl) {
        try {
            connection = await connectToToolServer(agent.toolServerUrl, settings);
            openAiTools = toOpenAITools(connection.tools);
        } catch (error) {
            // A dead tool server must not silence the bot entirely.
            messages.push({
                role: 'system',
                content: `Your tool server is unavailable (${error instanceof Error ? error.message : String(error)}). Answer from your own knowledge and say that the tools could not be reached.`
            });
        }
    }

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // On the final round drop the tools so the model has to produce prose.
        const offerTools = connection && round < MAX_TOOL_ROUNDS ? openAiTools : undefined;

        const completion = await callOpenAICompatible(
            baseUrl, apiKey, model, messages, headers, offerTools
        );

        if (completion.toolCalls.length === 0 || !connection) {
            return {
                reply: (completion.content || '').trim().substring(0, MAX_REPLY_LENGTH),
                modelName: model,
                toolsUsed
            };
        }

        messages.push({
            role: 'assistant',
            content: completion.content,
            tool_calls: completion.toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.args }
            }))
        });

        for (const call of completion.toolCalls) {
            onToolCall?.(call.name);
            if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);

            let result: string;
            try {
                const args = JSON.parse(call.args || '{}');
                result = await callTool(
                    connection,
                    call.name,
                    args,
                    await tokenForServer(agent.toolServerUrl!, settings)
                );
            } catch (error) {
                // Reported back to the model rather than thrown: it can retry
                // with different arguments or explain the failure to the user.
                result = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: result.slice(0, MAX_TOOL_RESULT_LENGTH)
            });
        }
    }

    return {
        reply: '',
        modelName: model,
        toolsUsed
    };
};

const modelNameFor = (settings: AISettings): string => {
    if (settings.aiProvider === 'groq') return settings.groqModel || 'llama-3.3-70b-versatile';
    if (settings.aiProvider === 'gemini') return settings.geminiModel || 'gemini-1.5-flash';
    return settings.openRouterModel || 'minimax/minimax-m3:free';
};

/**
 * Finds bots mentioned by the message and posts a reply for each of them.
 *
 * This runs entirely in the mentioning user's browser, on their own key. A
 * reply therefore only happens while that tab is open — close it mid-generation
 * and the bot stays silent, which is the accepted trade for never spending
 * anyone else's quota.
 */
export const triggerAgentReplies = async (
    trigger: BoardMessage,
    channelId: string,
    boardId: string,
    channelName: string,
    members: BoardMember[],
    settings: AISettings
): Promise<void> => {
    const mentioned = members.filter(m =>
        isBot(m) &&
        m.id !== trigger.authorId &&
        trigger.mentions.some(name => name.toLowerCase() === m.name.toLowerCase())
    );

    if (mentioned.length === 0) return;

    // Sequential: each agent sees the previous agent's reply, so a mention of
    // several agents reads as a conversation rather than parallel monologues.
    for (const agent of mentioned) {
        try {
            const history = await getRecentMessages(boardId, channelId, CONTEXT_MESSAGE_COUNT);
            const { reply, modelName, toolsUsed } = await generateAgentReply(
                agent, channelName, history, settings
            );

            await sendMessage({
                channelId,
                boardId,
                authorId: agent.id,
                authorName: agent.name,
                authorType: 'agent',
                content: reply,
                isAgentReply: true,
                modelName,
                toolsUsed: toolsUsed.length ? toolsUsed : undefined
            });
        } catch (error) {
            console.error(`[BoardAgent] ${agent.name} failed to reply:`, error);

            await sendMessage({
                channelId,
                boardId,
                authorId: agent.id,
                authorName: agent.name,
                authorType: 'agent',
                content: `⚠️ ${agent.name} could not respond: ${error instanceof Error ? error.message : String(error)}`,
                isAgentReply: true,
                modelName: modelNameFor(settings)
            });
        }
    }
};

/** Bounds on a discussion run, so one click can't spend an unbounded amount. */
export const MAX_DISCUSSION_BOTS = 4;
export const MAX_DISCUSSION_ROUNDS = 6;

export interface DiscussionOptions {
    boardId: string;
    channelId: string;
    channelName: string;
    /** Bots that take part, in speaking order. */
    bots: BoardMember[];
    /** What the discussion has to produce. */
    task: string;
    /** Full passes through the participant list. */
    rounds: number;
    settings: AISettings;
    onTurn?: (turn: number, totalTurns: number, botName: string) => void;
    /** Checked before every turn so the user can stop a run in progress. */
    shouldStop?: () => boolean;
}

/**
 * Runs a bounded bot-to-bot discussion: each bot speaks once per round, in
 * order, seeing everything said before it.
 *
 * Turns are scripted rather than driven by bots @mentioning each other. Letting
 * replies trigger replies would depend on models reliably naming each other and
 * would have no natural end — this way the exact number of calls is known up
 * front, which matters when every one of them costs the initiator tokens.
 */
export const runBotDiscussion = async (options: DiscussionOptions): Promise<void> => {
    const {
        boardId, channelId, channelName, bots, task,
        rounds, settings, onTurn, shouldStop
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

            try {
                // Re-read every turn so each bot sees the previous one's reply.
                const history = await getRecentMessages(boardId, channelId, CONTEXT_MESSAGE_COUNT);

                const { reply, modelName, toolsUsed } = await generateAgentReply(
                    bot, channelName, history, settings,
                    { participants: names, task, turn, totalTurns }
                );

                await sendMessage({
                    channelId,
                    boardId,
                    authorId: bot.id,
                    authorName: bot.name,
                    authorType: 'agent',
                    content: reply,
                    isAgentReply: true,
                    modelName,
                    toolsUsed: toolsUsed.length ? toolsUsed : undefined
                });
            } catch (error) {
                console.error(`[BoardAgent] ${bot.name} failed during discussion:`, error);

                await sendMessage({
                    channelId,
                    boardId,
                    authorId: bot.id,
                    authorName: bot.name,
                    authorType: 'agent',
                    content: `⚠️ ${bot.name} could not respond: ${error instanceof Error ? error.message : String(error)}`,
                    isAgentReply: true,
                    modelName: modelNameFor(settings)
                });
            }
        }
    }
};
