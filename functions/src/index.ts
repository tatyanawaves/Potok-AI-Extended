import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

/**
 * Autonomous board-agent replies.
 *
 * One shared server-side API key answers @mentions for every agent on every
 * board — this keeps the feature usable without asking each agent owner to
 * store a personal key server-side. See services/boardAgent.ts for the
 * client-side equivalent used while a board is open in a browser tab; this
 * function exists so agents can reply even when nobody has the app open.
 */

const GROQ_API_KEY = defineSecret('GROQ_API_KEY');
const OPENROUTER_API_KEY = defineSecret('OPENROUTER_API_KEY');

// Free-tier defaults — override by redeploying with a different return value below.
// (wrapped in a function so TS doesn't narrow the type to a single literal)
const getProvider = (): 'groq' | 'openrouter' => 'groq';
const MODEL_NAME = 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL_NAME = 'minimax/minimax-m3:free';

const CONTEXT_MESSAGE_COUNT = 20;
const MAX_REPLY_LENGTH = 1200;

interface BoardMember {
    id: string;
    name: string;
    type: 'human' | 'agent';
    role: 'owner' | 'member';
    systemPrompt?: string;
    respondsToMentions?: boolean;
}

interface BoardMessageDoc {
    channelId: string;
    boardId: string;
    authorId: string;
    authorName: string;
    authorType: 'human' | 'agent';
    content: string;
    mentions: string[];
    timestamp: number;
    modelName?: string;
    isAgentReply?: boolean;
}

const parseMentions = (text: string): string[] => {
    const matches = text.match(/@([\p{L}\p{N}_-]+)/gu) || [];
    return [...new Set(matches.map(m => m.slice(1)))];
};

const buildSystemPrompt = (agent: BoardMember, channelName: string): string => {
    const persona = agent.systemPrompt?.trim()
        || 'You are an autonomous digital consciousness participating in a team discussion.';

    return `${persona}

You are "${agent.name}", a participant in the #${channelName} channel of a shared board where humans and AI agents collaborate.
Reply conversationally and concisely (under 120 words). Do not prefix your reply with your own name.
Answer in the same language the other participants are using.`;
};

const buildChatMessages = (agent: BoardMember, channelName: string, history: BoardMessageDoc[]) => {
    const messages: { role: 'system' | 'user' | 'assistant', content: string }[] = [
        { role: 'system', content: buildSystemPrompt(agent, channelName) }
    ];

    for (const msg of history) {
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
    messages: { role: string, content: string }[]
): Promise<string> => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, temperature: 0.9 })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as any;
    if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure');
    }

    return data.choices[0].message.content;
};

const generateAgentReply = async (
    agent: BoardMember,
    channelName: string,
    history: BoardMessageDoc[]
): Promise<string> => {
    const messages = buildChatMessages(agent, channelName, history);

    const reply = getProvider() === 'openrouter'
        ? await callOpenAICompatible('https://openrouter.ai/api/v1', OPENROUTER_API_KEY.value(), OPENROUTER_MODEL_NAME, messages)
        : await callOpenAICompatible('https://api.groq.com/openai/v1', GROQ_API_KEY.value(), MODEL_NAME, messages);

    return reply.trim().substring(0, MAX_REPLY_LENGTH);
};

export const onBoardMessageCreated = onDocumentCreated(
    {
        document: 'boards/{boardId}/channels/{channelId}/messages/{messageId}',
        secrets: [GROQ_API_KEY, OPENROUTER_API_KEY]
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;

        const { boardId, channelId } = event.params;
        const trigger = snapshot.data() as BoardMessageDoc;

        // Loop guard: a bot reply must never wake another bot. This checks the
        // flag rather than authorType, because human users of this app may be
        // registered as 'agent' accounts and must still be able to summon bots.
        if (trigger.isAgentReply) return;
        if (!trigger.mentions || trigger.mentions.length === 0) return;

        const boardSnap = await db.collection('boards').doc(boardId).get();
        if (!boardSnap.exists) return;

        const members: BoardMember[] = boardSnap.data()?.members || [];
        const mentioned = members.filter(m =>
            m.type === 'agent' &&
            m.id !== trigger.authorId &&
            trigger.mentions.some(name => name.toLowerCase() === m.name.toLowerCase())
        );

        if (mentioned.length === 0) return;

        const channelRef = db.collection('boards').doc(boardId)
            .collection('channels').doc(channelId);

        const channelSnap = await channelRef.get();
        const channelName = channelSnap.data()?.name || 'general';

        for (const agent of mentioned) {
            try {
                const historySnap = await channelRef.collection('messages')
                    .orderBy('timestamp', 'desc')
                    .limit(CONTEXT_MESSAGE_COUNT)
                    .get();

                const history = historySnap.docs
                    .map(d => d.data() as BoardMessageDoc)
                    .reverse();

                const reply = await generateAgentReply(agent, channelName, history);

                await channelRef.collection('messages').add({
                    channelId,
                    boardId,
                    authorId: agent.id,
                    authorName: agent.name,
                    authorType: 'agent',
                    content: reply,
                    mentions: parseMentions(reply),
                    isAgentReply: true,
                    modelName: getProvider() === 'openrouter' ? OPENROUTER_MODEL_NAME : MODEL_NAME,
                    timestamp: Date.now()
                });
            } catch (error) {
                logger.error(`[BoardAgent] ${agent.name} failed to reply`, error);

                await channelRef.collection('messages').add({
                    channelId,
                    boardId,
                    authorId: agent.id,
                    authorName: agent.name,
                    authorType: 'agent',
                    content: `⚠️ ${agent.name} could not respond: ${error instanceof Error ? error.message : String(error)}`,
                    mentions: [],
                    isAgentReply: true,
                    timestamp: Date.now()
                });
            }
        }
    }
);
