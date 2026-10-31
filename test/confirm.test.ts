import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

describe('confirmations', () => {
    it('go through the in-app dialog, not window.confirm, which embedded views block', () => {
        const root = path.resolve(__dirname, '..');
        const files = [path.join(root, 'App.tsx'), ...['components', 'components/boards'].flatMap(d =>
            readdirSync(path.join(root, d)).filter(f => f.endsWith('.tsx') && f !== 'Confirm.tsx').map(f => path.join(root, d, f)))];
        const offenders = files.filter(f => /window\.confirm\(/.test(readFileSync(f, 'utf8'))).map(f => path.basename(f));
        expect(offenders).toEqual([]);
    }, 30_000);
});
