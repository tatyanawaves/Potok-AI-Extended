import { describe, it, expect } from 'vitest';
import { rememberedDecision, remember, forget, canRemember, permissionKey } from '../services/toolPermissions';

describe('remembered tool answers', () => {
    it('answers for the same board, bot and tool only', () => {
        const perms = remember({}, 'b1', 'Кодер', 'sandbox_shell', 'allow', 'Проект · Кодер · sandbox_shell');
        expect(rememberedDecision(perms, 'b1', 'кодер', 'sandbox_shell', false)).toBe('allow');
        expect(rememberedDecision(perms, 'b2', 'Кодер', 'sandbox_shell', false)).toBeUndefined();
        expect(rememberedDecision(perms, 'b1', 'Кодер', 'send_email', false)).toBeUndefined();
    });

    it("never lets an 'always allow' apply to someone else's bot, but keeps a 'never'", () => {
        const allow = remember({}, 'b1', 'Helper', 'send_email', 'allow', 'x');
        expect(rememberedDecision(allow, 'b1', 'Helper', 'send_email', true)).toBeUndefined();
        const deny = remember({}, 'b1', 'Helper', 'send_email', 'deny', 'x');
        expect(rememberedDecision(deny, 'b1', 'Helper', 'send_email', true)).toBe('deny');
        expect(canRemember('allow', true)).toBe(false);
        expect(canRemember('deny', true)).toBe(true);
    });

    it('forgets on request', () => {
        const perms = remember({}, 'b1', 'Кодер', 'sandbox_shell', 'deny', 'x');
        expect(forget(perms, permissionKey('b1', 'Кодер', 'sandbox_shell'))).toEqual({});
    });
});
