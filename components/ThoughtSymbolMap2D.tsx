import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { Thought, Language, SymbolCategory } from '../types';
import { translations } from '../translations';
import { buildSymbolGraph, SymbolNode, SymbolLink } from '../services/symbols';

interface ThoughtSymbolMap2DProps {
    thoughts: Thought[];
    language?: Language;
    cognitiveState?: any;
    symbolWeights?: Map<string, number>;
}

const categoryColors: Record<SymbolCategory, string> = {
    scientific: '#0ea5e9',    // Sky Blue
    cultural: '#eab308',      // Gold
    abstract: '#f8fafc',      // White
    literary: '#f43f5e',      // Rose
    concrete: '#94a3b8',      // Steel
    action: '#f97316',        // Orange
    technological: '#2dd4bf', // Teal
    emotional: '#ec4899',     // Pink
    nature: '#22c55e',        // Green
    temporal: '#a8a29e',      // Stone
    mystery: '#6366f1',       // Indigo
    // Was #1e1b4b — darker than the background it is drawn on, so every
    // cosmic symbol was invisible.
    cosmic: '#a78bfa',        // Violet
    social: '#fbbf24',        // Amber
    mathematical: '#67e8f9',  // Cyan
    mythical: '#c084fc',      // Light Purple
    biological: '#84cc16',    // Lime
    general: '#64748b'
};

const categoryNamesRu: Record<SymbolCategory, string> = {
    scientific: 'наука', cultural: 'культура', abstract: 'абстракция', literary: 'литература',
    concrete: 'предметы', action: 'действие', technological: 'технологии', emotional: 'эмоции',
    nature: 'природа', temporal: 'время', mystery: 'тайна', cosmic: 'космос', social: 'общество',
    mathematical: 'математика', mythical: 'мифы', biological: 'биология', general: 'прочее'
};

type Neighbourhood = Map<string, Array<{ id: string, weight: number }>>;

const idOf = (end: string | { id: string }): string => typeof end === 'string' ? end : end.id;

const ThoughtSymbolMap2D: React.FC<ThoughtSymbolMap2DProps> = ({ thoughts, language = 'ru', symbolWeights }) => {
    const t = translations[language] as any;
    const categoryLabel = (c: SymbolCategory) => language === 'en' ? c : categoryNamesRu[c];

    const fgRef = useRef<ForceGraphMethods>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    const [hidden, setHidden] = useState<Set<SymbolCategory>>(new Set());
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const fittedRef = useRef(false);

    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                if (e.contentRect.width > 0 && e.contentRect.height > 0) {
                    setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
                }
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const graph = useMemo(() => buildSymbolGraph(thoughts, symbolWeights), [thoughts, symbolWeights]);

    // What the legend offers is what the map actually contains, with counts.
    const categoryCounts = useMemo(() => {
        const counts = new Map<SymbolCategory, number>();
        graph.nodes.forEach(n => counts.set(n.category, (counts.get(n.category) || 0) + 1));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [graph]);

    /**
     * The graph handed to the renderer. Rebuilt only when the data or the
     * filter changes: force-graph mutates these objects with positions, and a
     * fresh copy on every hover would restart the layout.
     */
    const graphData = useMemo(() => {
        const nodes = graph.nodes.filter(n => !hidden.has(n.category)).map(n => ({ ...n }));
        const ids = new Set(nodes.map(n => n.id));
        const links = graph.links
            .filter(l => ids.has(l.source) && ids.has(l.target))
            .map(l => ({ ...l }));
        return { nodes, links };
    }, [graph, hidden]);

    const neighbours: Neighbourhood = useMemo(() => {
        const map: Neighbourhood = new Map();
        for (const link of graph.links) {
            const add = (from: string, to: string) => {
                const list = map.get(from) || [];
                list.push({ id: to, weight: link.weight });
                map.set(from, list);
            };
            add(link.source, link.target);
            add(link.target, link.source);
        }
        map.forEach(list => list.sort((a, b) => b.weight - a.weight));
        return map;
    }, [graph]);

    const maxLinkWeight = useMemo(
        () => graph.links.reduce((max, l) => Math.max(max, l.weight), 1),
        [graph]
    );

    // Strong links pull their symbols together; a single shared post barely does.
    useEffect(() => {
        const fg = fgRef.current as any;
        if (!fg) return;
        fg.d3Force('link')?.distance((l: SymbolLink) => 90 / Math.sqrt(l.weight));
        fg.d3Force('charge')?.strength(-70);
        fg.d3ReheatSimulation?.();
    }, [graphData]);

    useEffect(() => { fittedRef.current = false; }, [thoughts, symbolWeights]);

    const focusId = hoverId || selectedId;
    const focusSet = useMemo(() => {
        if (!focusId) return null;
        return new Set([focusId, ...(neighbours.get(focusId) || []).map(n => n.id)]);
    }, [focusId, neighbours]);

    const selected = useMemo(
        () => graph.nodes.find(n => n.id === selectedId) || null,
        [graph, selectedId]
    );

    const thoughtsById = useMemo(() => new Map(thoughts.map(th => [th.id, th])), [thoughts]);

    const centreOn = (id: string) => {
        const node: any = graphData.nodes.find(n => n.id === id);
        if (node && node.x !== undefined) {
            fgRef.current?.centerAt(node.x, node.y, 800);
            fgRef.current?.zoom(2.5, 800);
        }
        setSelectedId(id);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const needle = search.trim().toLowerCase();
        if (!needle) return;
        const match = graphData.nodes.find(n => n.name === needle)
            || graphData.nodes.find(n => n.name.includes(needle));
        if (match) centreOn(match.id);
    };

    const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const { x, y, val, category, name, interestOnly, frequency } = node as SymbolNode & { x: number, y: number };
        const color = categoryColors[category as SymbolCategory] || categoryColors.general;
        const dimmed = focusSet && !focusSet.has(node.id);
        const isFocus = node.id === focusId;

        ctx.globalAlpha = dimmed ? 0.15 : 1;

        if (isFocus) {
            ctx.shadowBlur = 20 / globalScale;
            ctx.shadowColor = color;
        }

        ctx.beginPath();
        ctx.arc(x, y, val, 0, 2 * Math.PI, false);

        if (interestOnly) {
            // Liked but never written about: an outline, not a filled node.
            ctx.setLineDash([2 / globalScale, 2 / globalScale]);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.fillStyle = color;
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        if (frequency > 5) {
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 0.6 / globalScale;
            ctx.beginPath();
            ctx.arc(x, y, val * 0.7, 0, 2 * Math.PI);
            ctx.stroke();
        }

        // Big symbols are labelled at any zoom, so the map says something
        // before the user thinks to zoom in; the rest appear as you do.
        const showLabel = isFocus || (focusSet ? focusSet.has(node.id) : false) || globalScale > 1.4 || val >= 9;
        if (showLabel && !dimmed) {
            const fontSize = Math.max(10 / globalScale, 2.5);
            ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const label = name.toUpperCase();
            const textWidth = ctx.measureText(label).width;
            const textHeight = fontSize * 1.3;

            ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
            ctx.fillRect(x - textWidth / 2 - 2, y + val + 2, textWidth + 4, textHeight);
            ctx.fillStyle = isFocus ? '#fff' : '#cbd5e1';
            ctx.fillText(label, x, y + val + 2 + textHeight / 2);
        }

        ctx.globalAlpha = 1;
    }, [focusSet, focusId]);

    const linkColor = useCallback((link: any) => {
        const a = idOf(link.source), b = idOf(link.target);
        if (focusSet) {
            return focusSet.has(a) && focusSet.has(b) && (a === focusId || b === focusId)
                ? 'rgba(34, 211, 238, 0.9)'
                : 'rgba(51, 65, 85, 0.08)';
        }
        if (link.isActive) return 'rgba(34, 211, 238, 0.8)';
        const strength = link.weight / maxLinkWeight;
        return `rgba(148, 163, 184, ${0.15 + strength * 0.5})`;
    }, [focusSet, focusId, maxLinkWeight]);

    const isEmpty = graph.nodes.length === 0;

    return (
        <div ref={containerRef} className="w-full h-full min-h-[300px] bg-slate-950 relative overflow-hidden">
            {/* Legend doubles as the category filter. */}
            <div className="absolute bottom-4 left-4 z-10 max-w-[calc(100%-2rem)] md:max-w-sm p-3 bg-black/60 backdrop-blur-md rounded-lg border border-cyan-500/20 font-mono">
                <div className="text-[10px] text-cyan-500 font-bold mb-2 uppercase tracking-widest flex justify-between gap-3">
                    <span>{t.neuralMap || 'Нейросетевая карта'}</span>
                    <span className="text-slate-500 font-normal normal-case">
                        {graph.nodes.length} {t.symbolsShort || 'симв.'} · {graph.links.length} {t.linksShort || 'связ.'}
                        {graph.totalSymbols > graph.nodes.length && ` · ${t.ofTotal || 'из'} ${graph.totalSymbols}`}
                    </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {categoryCounts.map(([cat, count]) => {
                        const off = hidden.has(cat);
                        return (
                            <button
                                key={cat}
                                onClick={() => setHidden(prev => {
                                    const next = new Set(prev);
                                    if (off) next.delete(cat); else next.add(cat);
                                    return next;
                                })}
                                className={`flex items-center gap-1.5 text-[9px] px-1.5 py-0.5 rounded border transition-all ${off ? 'border-slate-800 text-slate-600 line-through' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                                title={off ? (t.showCategory || 'Показать') : (t.hideCategory || 'Скрыть')}
                            >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: categoryColors[cat] }}></span>
                                {categoryLabel(cat)} {count}
                            </button>
                        );
                    })}
                </div>
            </div>

            <form onSubmit={handleSearch} className="absolute top-4 right-4 z-10">
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t.findSymbol || 'Найти символ…'}
                    className="w-40 md:w-56 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
            </form>

            {isEmpty && (
                <div className="absolute inset-0 flex items-center justify-center p-8 text-center pointer-events-none">
                    <p className="text-slate-600 text-sm max-w-xs leading-relaxed">
                        {t.emptyMap || 'Карта пока пуста. Символы появляются из постов и из того, что вы лайкаете.'}
                    </p>
                </div>
            )}

            {selected && (
                <aside className="absolute top-16 right-4 z-20 w-64 max-h-[60%] overflow-y-auto bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-4 shadow-2xl">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-white break-words">{selected.name}</div>
                            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: categoryColors[selected.category] }}></span>
                                {categoryLabel(selected.category)}
                            </div>
                        </div>
                        <button onClick={() => setSelectedId(null)} className="text-slate-500 hover:text-white">✕</button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3 text-[10px] font-mono">
                        <div className="bg-slate-950 rounded p-2">
                            <div className="text-slate-500">{t.inPosts || 'в постах'}</div>
                            <div className="text-slate-200 text-sm">{selected.frequency}</div>
                        </div>
                        <div className="bg-slate-950 rounded p-2">
                            <div className="text-slate-500">{t.interest || 'интерес'}</div>
                            <div className="text-slate-200 text-sm">{selected.weight.toFixed(1)} / 5</div>
                        </div>
                    </div>

                    {(neighbours.get(selected.id) || []).length > 0 && (
                        <div className="mt-3">
                            <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">
                                {t.relatedSymbols || 'Связан с'}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {(neighbours.get(selected.id) || []).slice(0, 10).map(n => (
                                    <button
                                        key={n.id}
                                        onClick={() => centreOn(n.id)}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-cyan-300"
                                    >
                                        {n.id}{n.weight > 1 ? ` ×${n.weight}` : ''}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {selected.thoughtIds.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                            <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                                {t.recentPosts || 'Посты'}
                            </div>
                            {selected.thoughtIds.slice(0, 4).map(id => {
                                const post = thoughtsById.get(id);
                                return post ? (
                                    <p key={id} className="text-[11px] text-slate-400 leading-snug line-clamp-3 border-l border-slate-700 pl-2">
                                        {post.content}
                                    </p>
                                ) : null;
                            })}
                        </div>
                    )}

                    {selected.interestOnly && (
                        <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
                            {t.interestOnlyHint || 'Этот символ пришёл из лайков — в собственных постах его ещё не было.'}
                        </p>
                    )}
                </aside>
            )}

            <ForceGraph2D
                ref={fgRef as any}
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphData}
                backgroundColor="#020617"
                nodeCanvasObject={paintNode}
                nodePointerAreaPaint={(node: any, color, ctx) => {
                    ctx.fillStyle = color;
                    ctx.beginPath(); ctx.arc(node.x!, node.y!, Math.max(node.val, 4), 0, 2 * Math.PI, false); ctx.fill();
                }}
                nodeLabel={(node: any) => `${node.name} · ${categoryLabel(node.category)} · ${node.frequency}`}
                linkWidth={(link: any) => (link.isActive ? 2 : 0.5) + Math.log2(link.weight + 1)}
                linkColor={linkColor}
                linkDirectionalParticles={(link: any) => link.isActive ? 2 : 0}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleSpeed={0.008}
                d3AlphaDecay={0.03}
                d3VelocityDecay={0.3}
                cooldownTicks={150}
                onEngineStop={() => {
                    // Fit once per data set: after that the view is the user's.
                    if (!fittedRef.current && graphData.nodes.length > 0) {
                        fgRef.current?.zoomToFit(600, 60);
                        fittedRef.current = true;
                    }
                }}
                onNodeHover={(node: any) => setHoverId(node ? node.id : null)}
                onNodeClick={(node: any) => centreOn(node.id)}
                onBackgroundClick={() => setSelectedId(null)}
            />
        </div>
    );
};

export default ThoughtSymbolMap2D;
