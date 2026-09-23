import { describe, it, expect } from 'vitest';
import {
    normalizeSymbolName, normalizeCategory, normalizeSymbols, parseThoughtJson, buildSymbolGraph
} from '../services/symbols';
import { Thought } from '../types';

const post = (id: string, timestamp: number, symbols: Array<{ name: string, category?: string }>): Thought => ({
    id, timestamp, content: id, type: 'evolution', authorType: 'agent', authorName: 'Neo',
    likes: 0, likedBy: [], comments: [],
    symbols: symbols.map(s => ({ name: s.name, category: (s.category || 'general') as any, activation: 0, weight: 1 }))
});

describe('normalizeSymbolName', () => {
    it('merges the spellings models produce for one concept', () => {
        expect(normalizeSymbolName('#Space')).toBe('space');
        expect(normalizeSymbolName(' "Space." ')).toBe('space');
        expect(normalizeSymbolName('SPACE')).toBe('space');
    });

    it('keeps Cyrillic and inner spaces', () => {
        expect(normalizeSymbolName('#Искусственный   интеллект!')).toBe('искусственный интеллект');
    });

    it('returns an empty string for punctuation only', () => {
        expect(normalizeSymbolName('#!!')).toBe('');
        expect(normalizeSymbolName(undefined)).toBe('');
    });
});

describe('normalizeCategory', () => {
    it('accepts the listed categories as they are', () => {
        expect(normalizeCategory('cosmic')).toBe('cosmic');
        expect(normalizeCategory(' Emotional ')).toBe('emotional');
    });

    it('maps the names models invent onto the list', () => {
        expect(normalizeCategory('Philosophy')).toBe('abstract');
        expect(normalizeCategory('technology')).toBe('technological');
        expect(normalizeCategory('space')).toBe('cosmic');
    });

    it('falls back to general for anything unknown', () => {
        expect(normalizeCategory('banana')).toBe('general');
        expect(normalizeCategory(undefined)).toBe('general');
    });
});

describe('normalizeSymbols', () => {
    it('accepts strings and objects, and drops repeats and empties', () => {
        const symbols = normalizeSymbols(['#Мир', { name: 'мир', category: 'nature' }, { name: '' }, 'time']);
        expect(symbols.map(s => s.name)).toEqual(['мир', 'time']);
    });

    it('returns nothing for a non-array', () => {
        expect(normalizeSymbols('space')).toEqual([]);
        expect(normalizeSymbols(null)).toEqual([]);
    });
});

describe('parseThoughtJson', () => {
    it('reads JSON wrapped in prose and normalises the symbols', () => {
        const parsed = parseThoughtJson('Sure! {"content":"hi","symbols":[{"name":"#Star","category":"astronomy"}]} done');
        expect(parsed.content).toBe('hi');
        expect(parsed.symbols).toEqual([{ name: 'star', category: 'cosmic', activation: 0, weight: 1 }]);
    });

    it('keeps the raw text when there is no JSON', () => {
        expect(parseThoughtJson('just words')).toEqual({ content: 'just words', symbols: [] });
    });
});

describe('buildSymbolGraph', () => {
    it('counts frequency and co-occurrence across posts', () => {
        const graph = buildSymbolGraph([
            post('a', 1, [{ name: 'star' }, { name: 'light' }]),
            post('b', 2, [{ name: '#Star' }, { name: 'Light.' }, { name: 'time' }])
        ]);

        const star = graph.nodes.find(n => n.id === 'star')!;
        expect(star.frequency).toBe(2);
        expect(graph.links.find(l => l.source === 'light' && l.target === 'star')?.weight).toBe(2);
        expect(graph.links).toHaveLength(3);
    });

    it('lights up the newest post by timestamp, not by position', () => {
        // Posts arrive newest-first; the newest here is the first element.
        const graph = buildSymbolGraph([
            post('new', 20, [{ name: 'a' }, { name: 'b' }]),
            post('old', 10, [{ name: 'c' }, { name: 'd' }])
        ]);

        expect(graph.links.find(l => l.source === 'a')?.isActive).toBe(true);
        expect(graph.links.find(l => l.source === 'c')?.isActive).toBe(false);
    });

    it('gives a symbol the category it was given most often', () => {
        const graph = buildSymbolGraph([
            post('1', 1, [{ name: 'moon', category: 'cosmic' }]),
            post('2', 2, [{ name: 'moon', category: 'cosmic' }]),
            post('3', 3, [{ name: 'moon', category: 'nature' }])
        ]);
        expect(graph.nodes[0].category).toBe('cosmic');
    });

    it('prefers a specific category over general on a tie', () => {
        const graph = buildSymbolGraph([
            post('1', 1, [{ name: 'moon', category: 'general' }]),
            post('2', 2, [{ name: 'moon', category: 'cosmic' }])
        ]);
        expect(graph.nodes[0].category).toBe('cosmic');
    });

    it('adds liked symbols the author never wrote as interest-only nodes', () => {
        const graph = buildSymbolGraph(
            [post('1', 1, [{ name: 'star' }])],
            new Map([['#Star', 3], ['ocean', 2.5], ['ignored', 1]])
        );

        expect(graph.nodes.find(n => n.id === 'star')?.weight).toBe(3);
        expect(graph.nodes.find(n => n.id === 'ocean')?.interestOnly).toBe(true);
        expect(graph.nodes.find(n => n.id === 'ignored')).toBeUndefined();
    });

    it('keeps the strongest nodes and drops links to the rest', () => {
        const graph = buildSymbolGraph([
            post('1', 1, [{ name: 'a' }, { name: 'b' }]),
            post('2', 2, [{ name: 'a' }, { name: 'c' }]),
            post('3', 3, [{ name: 'a' }])
        ], undefined, { maxNodes: 2 });

        expect(graph.totalSymbols).toBe(3);
        expect(graph.nodes).toHaveLength(2);
        expect(graph.nodes[0].id).toBe('a');
        graph.links.forEach(l => {
            expect(graph.nodes.some(n => n.id === l.source)).toBe(true);
            expect(graph.nodes.some(n => n.id === l.target)).toBe(true);
        });
    });

    it('returns an empty graph for no data', () => {
        expect(buildSymbolGraph([])).toEqual({ nodes: [], links: [], totalSymbols: 0 });
    });
});
