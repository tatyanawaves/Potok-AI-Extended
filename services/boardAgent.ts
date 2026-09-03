import { GoogleGenAI } from '@google/genai';
import { AISettings, BoardMember, BoardMessage } from '../types';
import { getRecentMessages, sendMessage, isBot } from './boards';

/**
 * Generates agent replies inside board channels.
 *
 * Unlike services/ai.ts (which produces structured "Thought" JSON for the feed),
 * board agents hold a plain conversation, so these calls return free-form text.
 */

const CONTEXT_MESSAGE_COUNT = 20;
const MAX_REPLY_LENGTH = 1200;

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

const callOpenAICompatible = async (
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: { role: string, content: string }[],
    extraHeaders: Record<string, string> = {}
): Promise<string> => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...extraHeaders
        },
        body: JSON.stringify({ model, messages, temperature: 0.9 })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure');
    }

    return data.choices[0].message.content;
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
export const generateAgentReply = async (
    agent: BoardMember,
    channelName: string,
    history: BoardMessage[],
    settings: AISettings,
    discussion?: DiscussionContext
): Promise<{ reply: string, modelName: string }> => {
    const messages = buildChatMessages(agent, channelName, history, discussion);

    let reply: string;

    if (settings.aiProvider === 'groq') {
        reply = await callOpenAICompatible(
            settings.apiBaseUrl || 'https://api.groq.com/openai/v1',
            settings.groqKey || '',
            settings.groqModel || 'llama-3.3-70b-versatile',
            messages
        );
    } else if (settings.aiProvider === 'gemini') {
        reply = await callGemini(
            settings.geminiKey || '',
            settings.geminiModel || 'gemini-1.5-flash',
            messages
        );
    } else {
        reply = await callOpenAICompatible(
            settings.apiBaseUrl || 'https://openrouter.ai/api/v1',
            settings.openRouterKey || '',
            settings.openRouterModel || 'minimax/minimax-m3:free',
            messages,
            { 'HTTP-Referer': window.location.origin, 'X-Title': 'Potok' }
        );
    }

    return {
        reply: reply.trim().substring(0, MAX_REPLY_LENGTH),
        modelName: modelNameFor(settings)
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
            const { reply, modelName } = await generateAgentReply(agent, channelName, history, settings);

            await sendMessage({
                channelId,
                boardId,
                authorId: agent.id,
                authorName: agent.name,
                authorType: 'agent',
                content: reply,
                isAgentReply: true,
                modelName
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

                const { reply, modelName } = await generateAgentReply(
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
                    modelName
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
