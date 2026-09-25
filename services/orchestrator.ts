import { AISettings, BoardMember } from '../types';
import { firestoreStore } from './firestoreStore';
import { runOrchestration as run, OrchestrationResult } from './runtime/orchestrate';
import { ToolApprover, ToolPolicy } from './runtime/turn';
import { OrchestrationProgress } from './orchestratorCore';

export * from './orchestratorCore';

/**
 * An orchestrated meeting run in this tab. The run itself is in
 * ./runtime/orchestrate; ./serverTasks starts the same run in the worker.
 */

export interface OrchestrationOptions {
    boardId: string;
    channelId: string;
    channelName: string;
    bots: BoardMember[];
    task: string;
    maxSteps: number;
    settings: AISettings;
    author: { id: string, name: string };
    toolPolicy?: ToolPolicy;
    approveTool?: ToolApprover;
    onProgress?: (progress: OrchestrationProgress) => void;
    shouldStop?: () => boolean;
}

export const runOrchestration = (options: OrchestrationOptions): Promise<OrchestrationResult> =>
    run({
        store: firestoreStore(options.settings),
        settings: options.settings,
        boardId: options.boardId,
        channelId: options.channelId,
        channelName: options.channelName,
        bots: options.bots,
        task: options.task,
        maxSteps: options.maxSteps,
        author: options.author,
        toolPolicy: options.toolPolicy ?? 'ask',
        approveTool: options.approveTool
    }, { onProgress: options.onProgress, shouldStop: options.shouldStop });
