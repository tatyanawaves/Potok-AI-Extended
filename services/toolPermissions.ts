/**
 * Remembered answers to tool requests, so a person is not asked the same
 * thing about the same bot again and again — dialogs answered on reflex
 * protect nothing.
 *
 * They are the person's own (kept in their settings), never the bot's: the
 * owner of a board cannot pre-approve anything on someone else's accounts.
 * For a bot someone else set up only "never" is remembered; "always allow"
 * would let that person's instructions act unseen.
 */

export type Decision = 'allow' | 'deny';

export interface Remembered {
    decision: Decision;
    /** Shown in Settings, e.g. "Проект · Кодер · sandbox_shell". */
    label: string;
}

export type ToolPermissions = Record<string, Remembered>;

export const permissionKey = (boardId: string, bot: string, tool: string): string =>
    `${boardId}::${bot.toLowerCase()}::${tool}`;

/** The remembered answer, if one applies; an "allow" never applies to a foreign bot. */
export const rememberedDecision = (
    permissions: ToolPermissions | undefined,
    boardId: string,
    bot: string,
    tool: string,
    foreign: boolean
): Decision | undefined => {
    const found = permissions?.[permissionKey(boardId, bot, tool)];
    if (!found) return undefined;
    if (found.decision === 'allow' && foreign) return undefined;
    return found.decision;
};

export const canRemember = (decision: Decision, foreign: boolean): boolean => decision === 'deny' || !foreign;

export const remember = (
    permissions: ToolPermissions | undefined,
    boardId: string,
    bot: string,
    tool: string,
    decision: Decision,
    label: string
): ToolPermissions => ({ ...(permissions || {}), [permissionKey(boardId, bot, tool)]: { decision, label } });

export const forget = (permissions: ToolPermissions | undefined, key: string): ToolPermissions => {
    const next = { ...(permissions || {}) };
    delete next[key];
    return next;
};
