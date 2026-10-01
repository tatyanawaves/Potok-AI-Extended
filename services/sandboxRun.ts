import { auth } from './firebase';
import { connect, callTool } from './mcp';
import { SandboxProvider, SANDBOX_NAMES, sandboxKeyStatus, sandboxUrl, workerUrl } from './connectors';
import { RunRequest, terminalEntryOf, toolCallFor } from './terminal';
import { TerminalEntry } from '../types';
import { boardScoped } from './runtime/turn';

/**
 * Runs what a person typed (/sh, /py, /js) or pressed ▶ on, in their own
 * cloud sandbox: the same one their bots use, on their own E2B or Daytona
 * key, which only the worker holds. No model is involved, so no tokens.
 */

/**
 * The sandbox this user has a key for; null when there is none. Daytona comes
 * first: on a board it is the board's own computer, which keeps its files.
 */
export const sandboxProvider = async (): Promise<SandboxProvider | null> => {
    if (!workerUrl) return null;
    const keys = await sandboxKeyStatus();
    return (['daytona', 'e2b'] as SandboxProvider[]).find(p => keys[p]) || null;
};

export const NO_SANDBOX = 'Нужна облачная песочница: добавьте ключ E2B или Daytona в Настройках. '
    + 'Команды выполняются в ней, а не на компьютере.';

/**
 * Runs the requests one after another in one sandbox, so a later one sees
 * the files and packages of an earlier one. A failure is recorded in its
 * entry and the rest still run; only a missing sandbox throws.
 */
export const runInSandbox = async (requests: RunRequest[], boardId: string): Promise<{ provider: string, entries: TerminalEntry[] }> => {
    const user = auth.currentUser;
    const provider = await sandboxProvider();
    if (!user || !provider) throw new Error(NO_SANDBOX);

    const token = await user.getIdToken();
    const connection = await connect(boardScoped(sandboxUrl(provider), boardId), token);
    const entries: TerminalEntry[] = [];

    for (const request of requests) {
        const { tool, args } = toolCallFor(request);
        try {
            entries.push(terminalEntryOf(tool, args, await callTool(connection, tool, args, token))!);
        } catch (error) {
            entries.push(terminalEntryOf(tool, args, `Error: ${error instanceof Error ? error.message : String(error)}`, true)!);
        }
    }

    return { provider: SANDBOX_NAMES[provider], entries };
};
