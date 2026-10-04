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
