import { describe, it, expect } from 'vitest';
import { approvalVia } from '../worker/src/runtimeParts';

/** A Firestore stand-in where the person answers after a couple of polls. */
const fakeRest = (answer: 'allowed' | 'denied' | null) => {
    const docs = new Map<string, any>();
    let polls = 0;
    return {
        docs,
        rest: {
            create: async (collection: string, data: any, id: string) => { docs.set(`${collection}/${id}`, { ...data }); return id; },
            get: async (path: string) => {
                const data = docs.get(path);
                if (!data) return null;
                if (answer && ++polls >= 2) data.status = answer;
                return { id: path, data, updateTime: '' };
            },
            delete: async (path: string) => { docs.delete(path); }
        } as any
    };
};

describe('tool requests from the server', () => {
    it('waits for the person\'s yes, then cleans up', async () => {
        const { rest, docs } = fakeRest('allowed');
        const ask = approvalVia(rest, 'b', 'bob', async () => { });
        expect(await ask('Helper', 'send_email', { to: 'x' }, 'foreign')).toBe(true);
        expect(docs.size).toBe(0);
    });

    it('takes a no as a no', async () => {
        const { rest } = fakeRest('denied');
        expect(await approvalVia(rest, 'b', 'bob', async () => { })('Helper', 'send_email', {})).toBe(false);
    });

    it('records who is asked, about what, and why', async () => {
        const { rest, docs } = fakeRest('allowed');
        let seen: any;
        const original = rest.create;
        rest.create = async (c: string, d: any, id: string) => { seen = d; return original(c, d, id); };
        await approvalVia(rest, 'b', 'bob', async () => { })('Helper', 'sandbox_shell', { command: 'ls' }, 'foreign');
        expect(seen).toMatchObject({ requestedBy: 'bob', bot: 'Helper', tool: 'sandbox_shell', reason: 'foreign', status: 'pending' });
        expect(JSON.parse(seen.args)).toEqual({ command: 'ls' });
        expect(docs.size).toBe(0);
    });
});
