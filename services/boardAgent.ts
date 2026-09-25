import { AISettings, BoardMember } from '../types';
import { McpTool } from './mcp';
import { firestoreStore } from './firestoreStore';
import * as runtime from './runtime/turn';
import { ToolApprover, ToolPolicy } from './runtime/turn';

/**
 * Bots for the browser: the runtime in ./runtime bound to Firestore through
 * the web SDK. The same runtime runs server tasks in the worker.
 */

export {
    MAX_TOOL_ROUNDS, MAX_REQUESTS_PER_TURN, MAX_DISCUSSION_BOTS, MAX_DISCUSSION_ROUNDS,
    toolServersOf, resetToolConnections, buildSystemPrompt, replyOrNotice, designBot
} from './runtime/turn';
export type { ToolPolicy, ToolApprover, Assignment, DiscussionContext, BotDesign } from './runtime/turn';
export { describeHttpError, isFatalProviderError } from './llm';

/** Answers every bot the message mentions, on the mentioning user's key. */
export const triggerAgentReplies = (
    mentions: string[],
    authorId: string,
    channelId: string,
    boardId: string,
    channelName: string,
    members: BoardMember[],
    settings: AISettings,
    toolPolicy: ToolPolicy = 'auto',
    approveTool?: ToolApprover
): Promise<void> => runtime.answerMentions({
    store: firestoreStore(settings),
    mentions, authorId, boardId, channelId, channelName, members, settings, toolPolicy, approveTool
});

export const runBotDiscussion = (options: Omit<runtime.DiscussionOptions, 'store'>): Promise<void> =>
    runtime.runBotDiscussion({ ...options, store: firestoreStore(options.settings) });

/** Connects to a tool server and lists what it offers. */
export const probeToolServer = (url: string, settings: AISettings): Promise<McpTool[]> =>
    runtime.probeToolServer(url, firestoreStore(settings));
