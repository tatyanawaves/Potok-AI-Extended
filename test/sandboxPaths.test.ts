import { describe, it, expect } from 'vitest';
import { resolvePath } from '../worker/src/sandbox';

describe('sandbox paths', () => {
    it('puts "~" and relative paths under the one home, and keeps absolute ones', () => {
        expect(resolvePath('~/check/sales.csv', '/root')).toBe('/root/check/sales.csv');
        expect(resolvePath('check/sales.csv', '/home/daytona')).toBe('/home/daytona/check/sales.csv');
        expect(resolvePath('./a.txt', '/home/user/')).toBe('/home/user/a.txt');
        expect(resolvePath('/tmp/x', '/root')).toBe('/tmp/x');
        expect(resolvePath('~', '/root')).toBe('/root');
        expect(resolvePath('  ', '/root')).toBe('/root');
    });
});

describe('which sandbox a person is on', () => {
    it('is found again right after it was created, though KV still reports it missing', async () => {
        const { boxStore } = await import('../worker/src/sandbox');
        // KV as it behaves for a fresh key: the write lands, reads lag behind.
        const writes: string[] = [];
        const laggingKv = { get: async () => null, put: async (key: string) => { writes.push(key); }, delete: async () => { } };
        const store = boxStore(laggingKv);
        expect(await store.get('box:u1:e2b')).toBeNull();
        await store.put('box:u1:e2b', '{"id":"sb-1"}', 1500);
        expect(await store.get('box:u1:e2b')).toBe('{"id":"sb-1"}');
        expect(writes).toEqual(['box:u1:e2b']);
        await store.delete('box:u1:e2b');
        expect(await store.get('box:u1:e2b')).toBeNull();
    });
});
