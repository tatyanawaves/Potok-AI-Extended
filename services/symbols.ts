import { AISymbol, SymbolCategory, Thought } from '../types';

/**
 * Symbols: the keywords a model pulls out of every post, and the neural map
 * drawn from them.
 *
 * Kept free of Firebase and of the providers so the rules below can be tested.
 * They are the whole reason the map is readable: every provider used to parse
 * symbols its own way, so "#Space", "space" and "Space." were three nodes, and
 * a category the model made up ("philosophy") drew as a white dot that the
 * legend never explained.
 */

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
    'scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action',
    'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic',
    'social', 'mathematical', 'mythical', 'biological', 'general'
];

/** What models answer instead of the listed names, mapped to the real ones. */
const CATEGORY_ALIASES: Record<string, SymbolCategory> = {
    science: 'scientific', physics: 'scientific', chemistry: 'scientific',
    culture: 'cultural', art: 'cultural', music: 'cultural', history: 'cultural',
    philosophy: 'abstract', philosophical: 'abstract', concept: 'abstract', idea: 'abstract',
    literature: 'literary', poetry: 'literary', language: 'literary',
    object: 'concrete', physical: 'concrete', place: 'concrete',
    activity: 'action', verb: 'action', movement: 'action',
    technology: 'technological', tech: 'technological', ai: 'technological', digital: 'technological', computing: 'technological',
    emotion: 'emotional', feeling: 'emotional', psychology: 'emotional',
    natural: 'nature', environment: 'nature', ecology: 'nature',
    time: 'temporal', future: 'temporal', past: 'temporal',
    mysterious: 'mystery', unknown: 'mystery', spiritual: 'mystery', religion: 'mystery',
    cosmos: 'cosmic', space: 'cosmic', astronomy: 'cosmic', universe: 'cosmic',
    society: 'social', politics: 'social', community: 'social', economics: 'social',
    math: 'mathematical', mathematics: 'mathematical', logic: 'mathematical',
    myth: 'mythical', mythology: 'mythical', fantasy: 'mythical',
    biology: 'biological', life: 'biological', health: 'biological', medicine: 'biological'
};

const MAX_SYMBOL_LENGTH = 40;

/**
 * The form a symbol is stored and matched under.
 *
 * Lowercased, stripped of the hashtag models like to add, of surrounding
 * punctuation and quotes, and of repeated spaces. Letters of any alphabet are
 * kept — most posts here are in Russian.
 */
export const normalizeSymbolName = (raw: unknown): string =>
    String(raw ?? '')
        .toLowerCase()
        .replace(/^[#@\s]+/u, '')
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .replace(/[\s_]+/g, ' ')
        .trim()
        .slice(0, MAX_SYMBOL_LENGTH);

/** A category from the fixed list; anything else is mapped or falls to 'general'. */
export const normalizeCategory = (raw: unknown): SymbolCategory => {
    const key = String(raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    if ((SYMBOL_CATEGORIES as string[]).includes(key)) return key as SymbolCategory;
    return CATEGORY_ALIASES[key] || 'general';
};

/**
 * Cleans a model's symbol list: accepts strings or {name, category} objects,
 * normalises both fields and drops empties and repeats.
 */
export const normalizeSymbols = (raw: unknown): AISymbol[] => {
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const symbols: AISymbol[] = [];

    for (const item of raw) {
        const isObject = item !== null && typeof item === 'object';
        const name = normalizeSymbolName(isObject ? (item as any).name : item);
        if (!name || seen.has(name)) continue;

        seen.add(name);
        symbols.push({
            name,
            category: normalizeCategory(isObject ? (item as any).category : undefined),
            activation: 0,
            weight: 1.0
        });
    }

    return symbols;
};

/**
 * The instruction every provider gives the model about symbols. One wording,
 * so the three providers produce the same shape and the same categories.
 */
export const SYMBOL_INSTRUCTION =
    `Extract 2-4 key symbols: short concepts of 1-2 words, in the language of the text, without "#". ` +
    `Category must be one of: ${SYMBOL_CATEGORIES.filter(c => c !== 'general').join(', ')}.`;

/** Parses a model answer holding JSON with `content`, `symbols` and friends. */
export const parseThoughtJson = (
    text: string
): { content: string, symbols: AISymbol[], type?: string, meta?: any } => {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
        return {
            content: data.content || '',
            type: data.type,
            meta: data.meta,
            symbols: normalizeSymbols(data.symbols)
        };
    } catch {
        return { content: text, symbols: [] };
    }
};

// --- The map ---------------------------------------------------------------

export interface SymbolNode {
    id: string;
    name: string;
    category: SymbolCategory;
    /** Posts the symbol appears in. */
    frequency: number;
    /** Interest from likes and own writing, 1 (none) to 5. */
    weight: number;
    lastSeen: number;
    /** Only known from likes: nothing this author wrote contains it. */
    interestOnly: boolean;
    /** Ids of the posts it appears in, newest first, for the details panel. */
    thoughtIds: string[];
    /** Node radius for the renderer. */
    val: number;
}

export interface SymbolLink {
    source: string;
    target: string;
    /** Posts in which both symbols appear together. */
    weight: number;
    /** Part of the newest post. */
    isActive: boolean;
}

export interface SymbolGraph {
    nodes: SymbolNode[];
    links: SymbolLink[];
    /** Before pruning, so the map can say it is showing a part. */
    totalSymbols: number;
}

export interface SymbolGraphOptions {
    /** Most nodes drawn; the weakest are dropped past this. */
    maxNodes?: number;
    /** Interest-only nodes kept at most, so likes do not crowd out writing. */
    maxInterestOnly?: number;
}

const radiusFor = (frequency: number, weight: number): number =>
    Math.min(16, 3 + Math.sqrt(frequency) * 2 + (weight - 1) * 1.5);

/**
 * Builds the map from posts and interest weights.
 *
 * - Symbols are matched by normalised name, so spelling variants merge.
 * - A symbol's category is the one it was given most often, not whichever
 *   post happened to be processed last.
 * - A link counts the posts two symbols share; the renderer draws strong
 *   links thicker and shorter.
 * - "Newest" is decided by timestamp. The posts arrive newest-first, and the
 *   old code took the last element — so it lit up the oldest post.
 */
export const buildSymbolGraph = (
    thoughts: Thought[],
    weights?: Map<string, number>,
    options: SymbolGraphOptions = {}
): SymbolGraph => {
    const { maxNodes = 150, maxInterestOnly = 20 } = options;

    const interest = new Map<string, number>();
    weights?.forEach((value, rawName) => {
        const name = normalizeSymbolName(rawName);
        if (!name) return;
        const weight = typeof value === 'number' && isFinite(value) ? value : 1;
        interest.set(name, Math.max(interest.get(name) || 1, weight));
    });

    const newest = thoughts.reduce<Thought | null>(
        (best, t) => (!best || (t.timestamp || 0) > (best.timestamp || 0) ? t : best),
        null
    );

    const nodes = new Map<string, SymbolNode>();
    const categoryVotes = new Map<string, Map<SymbolCategory, number>>();
    const links = new Map<string, SymbolLink>();

    const byNewest = [...thoughts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const thought of byNewest) {
        const symbols = normalizeSymbols(thought.symbols || []);
        const isNewest = thought === newest;

        for (const symbol of symbols) {
            let node = nodes.get(symbol.name);
            if (!node) {
                node = {
                    id: symbol.name,
                    name: symbol.name,
                    category: 'general',
                    frequency: 0,
                    weight: interest.get(symbol.name) || 1,
                    lastSeen: 0,
                    interestOnly: false,
                    thoughtIds: [],
                    val: 0
                };
                nodes.set(symbol.name, node);
            }

            node.frequency += 1;
            node.lastSeen = Math.max(node.lastSeen, thought.timestamp || 0);
            if (thought.id && node.thoughtIds.length < 20) node.thoughtIds.push(thought.id);

            const votes = categoryVotes.get(symbol.name) || new Map<SymbolCategory, number>();
            votes.set(symbol.category, (votes.get(symbol.category) || 0) + 1);
            categoryVotes.set(symbol.name, votes);
        }

        const names = symbols.map(s => s.name).sort();
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const id = `${names[i]}::${names[j]}`;
                const link = links.get(id);
                if (link) {
                    link.weight += 1;
                    link.isActive ||= isNewest;
                } else {
                    links.set(id, { source: names[i], target: names[j], weight: 1, isActive: isNewest });
                }
            }
        }
    }

    for (const [name, votes] of categoryVotes) {
        const node = nodes.get(name)!;
        // 'general' only wins when nothing more specific was ever given.
        const ranked = [...votes.entries()].sort((a, b) =>
            b[1] - a[1] || Number(a[0] === 'general') - Number(b[0] === 'general'));
        node.category = ranked.find(([c]) => c !== 'general')?.[0] || 'general';
    }

    // Symbols known only from likes: interests with no post of their own.
    const interestOnly = [...interest.entries()]
        .filter(([name, weight]) => !nodes.has(name) && weight > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxInterestOnly);

    for (const [name, weight] of interestOnly) {
        nodes.set(name, {
            id: name, name, category: 'general', frequency: 0, weight,
            lastSeen: 0, interestOnly: true, thoughtIds: [], val: 0
        });
    }

    const totalSymbols = nodes.size;
    const score = (n: SymbolNode) => n.frequency + (n.weight - 1) * 2;
    const kept = [...nodes.values()].sort((a, b) => score(b) - score(a)).slice(0, maxNodes);
    const keptIds = new Set(kept.map(n => n.id));

    for (const node of kept) node.val = radiusFor(node.frequency, node.weight);

    return {
        nodes: kept,
        links: [...links.values()].filter(l => keptIds.has(l.source) && keptIds.has(l.target)),
        totalSymbols
    };
};
