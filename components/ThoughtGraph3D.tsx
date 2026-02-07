import React, { useRef, useEffect, useState, useCallback } from 'react';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import * as d3 from 'd3';
import { Thought, Language, SymbolCategory } from '../types';
import { translations } from '../translations';
import { getEmbedding } from '../services/ai';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface ThoughtGraph3DProps {
  thoughts: Thought[];
  language?: Language;
  cognitiveState?: any; // New prop
}

interface SymbolMetadata {
    created: number;
    lastSeen: number;
    frequency: number;
    category: SymbolCategory;
    vector?: number[];
    weight: number; // For reinforcement
}

interface SymbolNode {
    id: string; 
    metadata: SymbolMetadata;
    lastType: string;
    x?: number;
    y?: number;
    z?: number;
}

const getCosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (!vecA.length || !vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// --- Visualization Config ---

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
    mathematical: '#94a3b8',  // Slate (Thin logic)
    mythical: '#c084fc',      // Light Purple (Star)
    biological: '#4ade80',    // Bright Green (Helix)
    general: '#475569'
};

const getGeometryForCategory = (category: SymbolCategory, size: number): THREE.BufferGeometry => {
    switch (category) {
        case 'scientific': return new THREE.TetrahedronGeometry(size);
        case 'cultural': return new THREE.OctahedronGeometry(size);
        case 'literary': return new THREE.IcosahedronGeometry(size);
        case 'concrete': return new THREE.BoxGeometry(size * 1.4, size * 1.4, size * 1.4);
        case 'action': return new THREE.TorusGeometry(size * 0.8, size * 0.3, 8, 16); 
        case 'technological': return new THREE.DodecahedronGeometry(size);
        case 'emotional': return new THREE.CapsuleGeometry(size * 0.5, size, 4, 8);
        case 'nature': return new THREE.ConeGeometry(size, size * 2, 8);
        case 'temporal': return new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 2, 12);
        case 'mystery': return new THREE.TorusKnotGeometry(size * 0.6, size * 0.2, 64, 8);
        case 'cosmic': return new THREE.TorusGeometry(size * 1.2, size * 0.1, 4, 32);
        
        // NEW 4
        case 'social': {
            const points = [];
            for (let i = 0; i < 10; i++) {
                points.push(new THREE.Vector2(Math.sin(i * 0.2) * size + size * 0.5, (i - 5) * 2));
            }
            return new THREE.LatheGeometry(points, 12);
        }
        case 'mathematical': return new THREE.PlaneGeometry(size * 2, size * 2);
        case 'mythical': {
            const shape = new THREE.Shape();
            const outerRad = size * 1.5;
            const innerRad = size * 0.6;
            for (let i = 0; i < 10; i++) {
                const rad = i % 2 === 0 ? outerRad : innerRad;
                const ang = (i / 10) * Math.PI * 2;
                if (i === 0) shape.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
                else shape.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
            }
            return new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
        }
        case 'biological': {
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-size, -size, 0),
                new THREE.Vector3(0, 0, size),
                new THREE.Vector3(size, size, 0)
            ]);
            return new THREE.TubeGeometry(curve, 20, 2, 8, false);
        }

        case 'abstract': 
        default: return new THREE.SphereGeometry(size, 24, 24);
    }
};

// --- Component ---

const ThoughtGraph3D: React.FC<ThoughtGraph3DProps> = ({ thoughts, language = 'ru', cognitiveState }) => {
  const fgRef = useRef<ForceGraphMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const t = translations[language];
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [graphData, setGraphData] = useState({ nodes: [] as SymbolNode[], links: [] as any[] });
  const [vectorCache, setVectorCache] = useState<Record<string, number[]>>({});

  // Pulse animation factor (0 to 1)
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
      let animId: number;
      const animate = (time: number) => {
          // Speed depends on cognitive intensity
          const speed = 0.002 + (cognitiveState?.intensity || 0) * 0.005;
          setPulse((Math.sin(time * speed) + 1) / 2);
          animId = requestAnimationFrame(animate);
      };
      animId = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animId);
  }, [cognitiveState?.intensity]);

  useEffect(() => {
    const processGraph = async () => {
        const nodesMap = new Map<string, SymbolNode>();
        const linksMap = new Map<string, { source: string, target: string, weight: number, type: 'semantic' | 'cluster', isActive: boolean }>();
        const updatedCache = { ...vectorCache };
        let cacheChanged = false;

        for (const thought of thoughts) {
            const isLatest = thought === thoughts[thoughts.length - 1];
            for (const sym of (thought.symbols || [])) {
                const sid = sym.name.toLowerCase();
                if (!updatedCache[sid]) {
                    const vec = await getEmbedding(sid);
                    if (vec.length > 0) { updatedCache[sid] = vec; cacheChanged = true; }
                }
                const existing = nodesMap.get(sid);
                const category = sym.category as SymbolCategory;
                if (existing) {
                    existing.metadata.frequency += 1;
                    existing.metadata.lastSeen = Date.now();
                    existing.lastType = thought.type;
                    existing.metadata.weight = Math.max(existing.metadata.weight, sym.weight || 1);
                    if (existing.metadata.category === 'general') existing.metadata.category = category;
                } else {
                    nodesMap.set(sid, {
                        id: sid, lastType: thought.type,
                        metadata: { 
                            created: Date.now(), 
                            lastSeen: Date.now(), 
                            frequency: 1, 
                            category, 
                            vector: updatedCache[sid],
                            weight: sym.weight || 1
                        }
                    });
                }
            }
            // Links
            const sNames = (thought.symbols || []).map(s => s.name.toLowerCase());
            for (let i = 0; i < sNames.length; i++) {
                for (let j = i + 1; j < sNames.length; j++) {
                    const a = sNames[i] < sNames[j] ? sNames[i] : sNames[j];
                    const b = sNames[i] < sNames[j] ? sNames[j] : sNames[i];
                    const lid = `${a}::${b}`;
                    if (linksMap.has(lid)) {
                        const l = linksMap.get(lid)!; l.weight += 1; l.isActive = isLatest;
                    } else linksMap.set(lid, { source: a, target: b, weight: 1, type: 'semantic', isActive: isLatest });
                }
            }
        }
        if (cacheChanged) setVectorCache(updatedCache);

        // Vector Clustering
        const nodesArray = Array.from(nodesMap.values());
        for (let i = 0; i < nodesArray.length; i++) {
            for (let j = i + 1; j < nodesArray.length; j++) {
                const nA = nodesArray[i], nB = nodesArray[j];
                if (nA.metadata.vector && nB.metadata.vector) {
                    const sim = getCosineSimilarity(nA.metadata.vector, nB.metadata.vector);
                    if (sim > 0.83) {
                        const lid = `cluster::${nA.id}-${nB.id}`;
                        if (!linksMap.has(lid)) linksMap.set(lid, { source: nA.id, target: nB.id, weight: sim, type: 'cluster', isActive: false });
                    }
                }
            }
        }
        setGraphData({ nodes: nodesArray, links: Array.from(linksMap.values()) });
    };
    processGraph();
  }, [thoughts, language]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
        for (let e of entries) setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleGraphMount = useCallback((fg: any) => {
    if (!fg) return;
    fgRef.current = fg;
    const scene = fg.scene();
    scene.fog = new THREE.FogExp2('#000000', 0.0008);
    fg.postProcessingComposer().addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.6, 0.4, 0.1));
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[300px] bg-black rounded-lg overflow-hidden border border-slate-900 relative">
       <div className="absolute top-4 left-4 text-[9px] font-mono text-slate-500 uppercase tracking-widest pointer-events-none z-10 flex flex-col gap-1 select-none bg-black/40 p-2 backdrop-blur-sm rounded">
            <span className="text-cyan-500 font-bold mb-1">MORPHOLOGICAL MAP v7.0</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 opacity-80">
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#0ea5e9]"></span> Sci (Tetra)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#eab308]"></span> Cult (Octa)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#ffffff]"></span> Abs (Sphere)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#f43f5e]"></span> Lit (Icosa)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#64748b]"></span> Obj (Box)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#f97316]"></span> Act (Torus)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#2dd4bf]"></span> Tech (Dodeca)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#ec4899]"></span> Emo (Capsule)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#22c55e]"></span> Nat (Cone)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#a8a29e]"></span> Time (Cyl)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#6366f1]"></span> Mys (Knot)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#1e1b4b]"></span> Cos (Ring)</div>
                {/* NEW 4 */}
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#fbbf24]"></span> Soc (Lathe)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#94a3b8]"></span> Math (Plane)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#c084fc]"></span> Myth (Star)</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#4ade80]"></span> Bio (Helix)</div>
            </div>
        </div>

      <ForceGraph3D
        ref={fgRef as any} width={dimensions.width} height={dimensions.height} graphData={graphData} backgroundColor="#000000" showNavInfo={false}
        d3VelocityDecay={0.4} d3Force={('link', (d3 as any).forceLink().id((d: any) => d.id).distance(l => l.type === 'cluster' ? 25 : 90).strength(l => l.type === 'cluster' ? 0.7 : 0.2))}
        nodeColor={(node: any) => categoryColors[node.metadata.category] || '#ffffff'}
        nodeThreeObject={(node: any) => {
          const category = node.metadata.category as SymbolCategory;
          const color = categoryColors[category] || '#ffffff';
          
          // Rank-based growth: Frequency ^ 0.8 for strong visual hierarchy
          const weightBonus = (node.metadata.weight - 1) * 2;
          const size = 3 + Math.pow(node.metadata.frequency, 0.8) * 3.5 + weightBonus;
          
          const group = new THREE.Group();
          const geometry = getGeometryForCategory(category, size);
          
          const isRecentlyActive = node.metadata.lastSeen > Date.now() - 5000;
          const reinforcementFactor = node.metadata.weight > 1.5;

          const material = new THREE.MeshPhysicalMaterial({
            color: color,
            roughness: 0.1,
            metalness: 0.4,
            transparent: true,
            opacity: 0.9,
            emissive: color,
            emissiveIntensity: isRecentlyActive ? 0.6 : (node.metadata.frequency > 5 ? 0.4 : 0.15),
            clearcoat: 1.0,
            transmission: 0.1,
            side: THREE.DoubleSide
          });

          // Reinforced nodes always glow a bit more
          if (reinforcementFactor) {
              material.emissiveIntensity += (node.metadata.weight * 0.1);
          }
          
          const mesh = new THREE.Mesh(geometry, material);
          
          // Apply cognitive pulse
          if (isRecentlyActive || reinforcementFactor) {
              const basePulse = reinforcementFactor ? 0.05 : 0;
              const pulseScale = 1 + pulse * (cognitiveState?.intensity || 0.1) + basePulse;
              mesh.scale.set(pulseScale, pulseScale, pulseScale);
              material.emissiveIntensity += pulse * (node.metadata.weight * 0.2);
          }

          group.add(mesh);

          // Data Rings for frequent/heavy symbols
          if (node.metadata.frequency > 2) {
             const ringCount = Math.min(Math.floor(node.metadata.frequency / 3), 3);
             for(let i=0; i<ringCount; i++) {
                const r = new THREE.Mesh(
                    new THREE.TorusGeometry(size * (1.3 + i*0.3), 0.1, 8, 32), 
                    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.3 - i*0.1 })
                );
                r.rotation.x = Math.PI / (2 + i);
                r.rotation.y = Math.PI / (4 - i);
                group.add(r);
             }
          }

          const sprite = new SpriteText(node.id);
          sprite.color = '#ffffff'; sprite.textHeight = 3 + (node.metadata.frequency * 0.4); 
          sprite.position.set(0, size + 6, 0); sprite.fontFace = 'Courier New';
          sprite.backgroundColor = 'rgba(0,0,0,0.6)'; sprite.padding = 3; sprite.borderRadius = 4;
          group.add(sprite);
          return group;
        }}
        linkColor={(link: any) => link.type === 'cluster' ? 'rgba(0,0,0,0)' : (link.isActive ? '#22d3ee' : '#1e293b')} 
        linkWidth={(link: any) => link.isActive ? 2 : 1} linkOpacity={(link: any) => link.isActive ? 1 : 0.15}
        linkDirectionalParticles={(link: any) => link.isActive ? 4 : 0} linkDirectionalParticleWidth={3} linkDirectionalParticleSpeed={0.01}
        onNodeClick={(node: any) => {
            const distance = 100; const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
            fgRef.current?.cameraPosition({ x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, { x: node.x, y: node.y, z: node.z }, 1500);
        }}
      />
    </div>
  );
};

export default ThoughtGraph3D;
