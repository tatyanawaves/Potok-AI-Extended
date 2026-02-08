import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { Thought, Language, SymbolCategory, AISymbol } from '../types';
import { translations } from '../translations';

interface ThoughtSymbolMap2DProps {
    thoughts: Thought[];
    language?: Language;
    cognitiveState?: any;
    symbolWeights?: Map<string, number>;
}

interface SymbolNode {
    id: string;
    name: string;
    category: SymbolCategory;
    frequency: number;
    weight: number;
    lastSeen: number;
    x?: number;
    y?: number;
    val: number; // Size for force graph
}

interface SymbolLink {
    source: string;
    target: string;
    weight: number;
    isActive: boolean;
}

const categoryColors: Record<SymbolCategory, string> = {
    scientific: '#0ea5e9',    // Sky Blue
    cultural: '#eab308',      // Gold
    abstract: '#ffffff',      // Pure White
    literary: '#f43f5e',      // Rose
    concrete: '#64748b',      // Steel
    action: '#f97316',        // Orange
    technological: '#2dd4bf', // Teal
    emotional: '#ec4899',     // Pink
    nature: '#22c55e',        // Green
    temporal: '#a8a29e',      // Stone
    mystery: '#6366f1',       // Indigo
    cosmic: '#1e1b4b',        // Darkest Blue
    social: '#fbbf24',        // Amber
    mathematical: '#94a3b8',  // Slate
    mythical: '#c084fc',      // Light Purple
    biological: '#4ade80',    // Bright Green
    general: '#475569'
};

const ThoughtSymbolMap2D: React.FC<ThoughtSymbolMap2DProps> = ({ thoughts, language = 'ru', cognitiveState, symbolWeights }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const [graphData, setGraphData] = useState({ nodes: [] as SymbolNode[], links: [] as SymbolLink[] });

    // Handle resizing
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => {
            for (let e of entries) {
                if (e.contentRect.width > 0 && e.contentRect.height > 0) {
                    setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
                }
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // Process data for the graph
    useEffect(() => {
        const nodesMap = new Map<string, SymbolNode>();
        const linksMap = new Map<string, SymbolLink>();

        if (thoughts.length === 0) {
            setGraphData({ nodes: [], links: [] });
            return;
        }

        thoughts.forEach((thought, idx) => {
            const isLatest = idx === thoughts.length - 1;
            const symbols = thought.symbols || [];

            symbols.forEach(sym => {
                const id = sym.name.toLowerCase();
                const existing = nodesMap.get(id);

                // Get weight from global symbolWeights if available, otherwise from symbol itself
                const globalWeight = symbolWeights?.get(sym.name) || sym.weight || 1;

                if (existing) {
                    existing.frequency += 1;
                    existing.lastSeen = Math.max(existing.lastSeen, thought.timestamp);
                    existing.weight = Math.max(existing.weight, globalWeight);
                    existing.val = 2 + Math.sqrt(existing.frequency) * 2 + (existing.weight - 1) * 3;
                } else {
                    nodesMap.set(id, {
                        id,
                        name: sym.name,
                        category: sym.category as SymbolCategory,
                        frequency: 1,
                        weight: globalWeight,
                        lastSeen: thought.timestamp,
                        val: 3 + (globalWeight - 1) * 3
                    });
                }
            });

            // Semantic links within a thought
            const sIds = symbols.map(s => s.name.toLowerCase());
            for (let i = 0; i < sIds.length; i++) {
                for (let j = i + 1; j < sIds.length; j++) {
                    const a = sIds[i] < sIds[j] ? sIds[i] : sIds[j];
                    const b = sIds[i] < sIds[j] ? sIds[j] : sIds[i];
                    const lid = `${a}::${b}`;

                    if (linksMap.has(lid)) {
                        const l = linksMap.get(lid)!;
                        l.weight += 1;
                        if (isLatest) l.isActive = true;
                    } else {
                        linksMap.set(lid, { source: a, target: b, weight: 1, isActive: isLatest });
                    }
                }
            }
        });

        setGraphData({
            nodes: Array.from(nodesMap.values()),
            links: Array.from(linksMap.values())
        });
    }, [thoughts]);

    // Optimized Node Drawing
    const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const { x, y, val, category, name, lastSeen, frequency } = node;
        const color = categoryColors[category as SymbolCategory] || '#ffffff';
        const isRecent = lastSeen > Date.now() - 10000;

        // Pulse effect for recent nodes
        let pulseScale = 1;
        if (isRecent) {
            const t = performance.now() * 0.005;
            pulseScale = 1 + Math.sin(t) * 0.15 * (cognitiveState?.arousal || 0.5);
        }

        const r = val * pulseScale;

        // Glow effect (expensive, only for high zoom or important nodes)
        if (globalScale > 1.5 || isRecent) {
            ctx.shadowBlur = 15 / globalScale;
            ctx.shadowColor = color;
        }

        // Main Circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();

        // Reset shadow
        ctx.shadowBlur = 0;

        // Inner details (rings for high frequency)
        if (frequency > 5) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 0.5 / globalScale;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.7, 0, 2 * Math.PI);
            ctx.stroke();
        }

        // Text (only when zoomed in enough)
        if (globalScale > 1.0) {
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const labelText = name.toUpperCase();
            const textHeight = fontSize * 1.2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            const textWidth = ctx.measureText(labelText).width;
            ctx.fillRect(x - textWidth / 2 - 2, y + r + 4, textWidth + 4, textHeight);

            ctx.fillStyle = '#fff';
            ctx.fillText(labelText, x, y + r + 4 + textHeight / 2);
        }
    }, [cognitiveState]);

    return (
        <div ref={containerRef} className="w-full h-full min-h-[300px] bg-slate-950 border border-slate-900 relative">
            <div className="absolute top-4 left-4 z-10 pointer-events-none p-3 bg-black/60 backdrop-blur-md rounded-lg border border-cyan-500/20 font-mono">
                <div className="text-[10px] text-cyan-500 font-bold mb-2 uppercase tracking-widest">Neural Projection v2.0 (2D Optimized)</div>
                <div className="flex flex-wrap gap-2 max-w-[200px]">
                    {Object.entries(categoryColors).slice(0, 8).map(([cat, color]) => (
                        <div key={cat} className="flex items-center gap-1.5 text-[8px] text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }}></span>
                            {cat.substring(0, 4)}
                        </div>
                    ))}
                </div>
            </div>

            <ForceGraph2D
                ref={fgRef as any}
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphData}
                backgroundColor="#020617"
                nodeCanvasObject={paintNode}
                nodePointerAreaPaint={(node, color, ctx) => {
                    ctx.fillStyle = color;
                    ctx.beginPath(); ctx.arc(node.x!, node.y!, node.val!, 0, 2 * Math.PI, false); ctx.fill();
                }}
                linkWidth={(link: any) => link.isActive ? 2 : 1}
                linkColor={(link: any) => link.isActive ? '#22d3ee' : 'rgba(30, 41, 59, 0.3)'}
                linkDirectionalParticles={(link: any) => link.isActive ? 3 : 0}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleSpeed={0.01}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                cooldownTicks={100}
                onNodeClick={(node) => {
                    fgRef.current?.centerAt(node.x, node.y, 1000);
                    fgRef.current?.zoom(2.5, 1000);
                }}
            />
        </div>
    );
};

export default ThoughtSymbolMap2D;
