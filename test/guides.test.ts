import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GUIDES } from '../services/guides';

const root = path.resolve(__dirname, '..');
const sources = [
    path.join(root, 'App.tsx'),
    ...['components', 'components/boards'].flatMap(dir =>
        readdirSync(path.join(root, dir)).filter(f => f.endsWith('.tsx')).map(f => path.join(root, dir, f)))
];

describe('learning guides', () => {
    it('has a guide behind every "?" in the interface', () => {
        const ids = new Set(GUIDES.map(g => g.id));
        const missing = sources.flatMap(file =>
            [...readFileSync(file, 'utf8').matchAll(/<Hint id="([a-z-]+)"/g)]
                .map(m => m[1])
                .filter(id => !ids.has(id))
                .map(id => `${path.basename(file)}: ${id}`));
        expect(missing).toEqual([]);
    }, 30_000);

    it('has unique ids and something to say in each guide', () => {
        expect(new Set(GUIDES.map(g => g.id)).size).toBe(GUIDES.length);
        for (const guide of GUIDES) {
            expect(guide.summary.length, guide.id).toBeGreaterThan(10);
            expect(guide.steps.length, guide.id).toBeGreaterThan(0);
        }
    });
});
