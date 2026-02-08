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

// --- Visualization Config & Caching ---

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

// Geometry cache
const geometryCache = new Map<string, THREE.BufferGeometry>();

const getCachedGeometry = (category: SymbolCategory): THREE.BufferGeometry => {
    if (geometryCache.has(category)) return geometryCache.get(category)!;
    
    let geo: THREE.BufferGeometry;
    const size = 1; // Base size for all cached geometries, scale via mesh.scale

    switch (category) {
        case 'scientific': geo = new THREE.TetrahedronGeometry(size); break;
        case 'cultural': geo = new THREE.OctahedronGeometry(size); break;
        case 'literary': geo = new THREE.IcosahedronGeometry(size); break;
        case 'concrete': geo = new THREE.BoxGeometry(size * 1.4, size * 1.4, size * 1.4); break;
        case 'action': geo = new THREE.TorusGeometry(size * 0.8, size * 0.3, 8, 16); break;
        case 'technological': geo = new THREE.DodecahedronGeometry(size); break;
        case 'emotional': geo = new THREE.CapsuleGeometry(size * 0.5, size, 4, 8); break;
        case 'nature': geo = new THREE.ConeGeometry(size, size * 2, 8); break;
        case 'temporal': geo = new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 2, 12); break;
        case 'mystery': geo = new THREE.TorusKnotGeometry(size * 0.6, size * 0.2, 64, 8); break;
        case 'cosmic': geo = new THREE.TorusGeometry(size * 1.2, size * 0.1, 4, 32); break;
        case 'social': {
            const points = [];
            for (let i = 0; i < 10; i++) {
                points.push(new THREE.Vector2(Math.sin(i * 0.2) * size + size * 0.5, (i - 5) * 2));
            }
            geo = new THREE.LatheGeometry(points, 12);
            break;
        }
        case 'mathematical': geo = new THREE.PlaneGeometry(size * 2, size * 2); break;
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
            geo = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
            break;
        }
        case 'biological': {
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-size, -size, 0),
                new THREE.Vector3(0, 0, size),
                new THREE.Vector3(size, size, 0)
            ]);
            geo = new THREE.TubeGeometry(curve, 20, 2, 8, false);
            break;
        }
        case 'abstract': 
        default: geo = new THREE.SphereGeometry(size, 16, 16); // Reduced segments
    }
    
    geometryCache.set(category, geo);
    return geo;
};

// Material cache
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

const getCachedMaterial = (color: string, isRecent: boolean, frequency: number, weight: number): THREE.MeshStandardMaterial => {
    // We use a simpler material for better performance
    // and key it by color and basic state to reuse
    const key = `${color}_${isRecent}_${frequency > 5}_${weight > 1.5}`;
    if (materialCache.has(key)) return materialCache.get(key)!;

    const material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.5,
        transparent: true,
        opacity: 0.85,
        emissive: color,
        emissiveIntensity: isRecent ? 0.6 : (frequency > 5 ? 0.4 : 0.15),
        side: THREE.DoubleSide
    });

    if (weight > 1.5) {
        material.emissiveIntensity += (weight * 0.1);
    }

    materialCache.set(key, material);
    return material;
};

// --- Component ---

const ThoughtGraph3D: React.FC<ThoughtGraph3DProps> = ({ thoughts, language = 'ru', cognitiveState }) => {
  const fgRef = useRef<ForceGraphMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const t = translations[language];
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [graphData, setGraphData] = useState({ nodes: [] as SymbolNode[], links: [] as any[] });
  const [vectorCache, setVectorCache] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const processGraph = async () => {
        const nodesMap = new Map<string, SymbolNode>();
        const linksMap = new Map<string, { source: string, target: string, weight: number, type: 'semantic' | 'cluster', isActive: boolean }>();
        const updatedCache = { ...vectorCache };
        let cacheChanged = false;

        if (thoughts.length === 0) {
            setGraphData({ nodes: [], links: [] });
            return;
        }

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
                    existing.metadata.lastSeen = Math.max(existing.metadata.lastSeen, Date.now());
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
                        const l = linksMap.get(lid)!; 
                        l.weight += 1; 
                        if (isLatest) l.isActive = true;
                    } else linksMap.set(lid, { source: a, target: b, weight: 1, type: 'semantic', isActive: isLatest });
                }
            }
        }
        if (cacheChanged) setVectorCache(updatedCache);

        // Vector Clustering (Optimized)
        const nodesArray = Array.from(nodesMap.values());
        if (nodesArray.length < 150) { // Limit O(n^2) clustering for performance
            for (let i = 0; i < nodesArray.length; i++) {
                for (let j = i + 1; j < nodesArray.length; j++) {
                    const nA = nodesArray[i], nB = nodesArray[j];
                    if (nA.metadata.vector && nB.metadata.vector) {
                        const sim = getCosineSimilarity(nA.metadata.vector, nB.metadata.vector);
                        if (sim > 0.85) {
                            const lid = `cluster::${nA.id}-${nB.id}`;
                            if (!linksMap.has(lid)) linksMap.set(lid, { source: nA.id, target: nB.id, weight: sim, type: 'cluster', isActive: false });
                        }
                    }
                }
            }
        }
        setGraphData({ nodes: nodesArray, links: Array.from(linksMap.values()) });
    };
    processGraph();
  }, [thoughts]);

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

  const handleGraphMount = useCallback((fg: any) => {
    if (!fg) return;
    fgRef.current = fg;
    const scene = fg.scene();
    scene.fog = new THREE.FogExp2('#000000', 0.001);
    
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 
        1.2, 0.4, 0.15
    );
    fg.postProcessingComposer().addPass(bloomPass);

    fg.d3Force('charge').strength(-120);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[300px] bg-black rounded-lg overflow-hidden border border-slate-900 relative">
       <div className="absolute top-4 left-4 text-[9px] font-mono text-slate-500 uppercase tracking-widest pointer-events-none z-10 flex flex-col gap-1 select-none bg-black/40 p-2 backdrop-blur-sm rounded">
            <span className="text-cyan-500 font-bold mb-1">MORPHOLOGICAL MAP v7.1</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 opacity-80">
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#0ea5e9]"></span> Sci</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#eab308]"></span> Cult</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#ffffff]"></span> Abs</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#f43f5e]"></span> Lit</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#64748b]"></span> Obj</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#f97316]"></span> Act</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#2dd4bf]"></span> Tech</div>
                <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#ec4899]"></span> Emo</div>
            </div>
        </div>

      <ForceGraph3D
        ref={fgRef as any} 
        width={dimensions.width} 
        height={dimensions.height} 
        graphData={graphData} 
        backgroundColor="#000000" 
        showNavInfo={false}
        onEngineStop={() => {}}
        cooldownTicks={100}
        d3VelocityDecay={0.3} 
        nodeThreeObject={(node: any) => {
          const category = node.metadata.category as SymbolCategory;
          const color = categoryColors[category] || '#ffffff';
          
          const weightBonus = (node.metadata.weight - 1) * 2;
          const size = 3 + Math.pow(node.metadata.frequency, 0.8) * 3.5 + weightBonus;
          
          const group = new THREE.Group();
          const geometry = getCachedGeometry(category);
          
          const isRecentlyActive = node.metadata.lastSeen > Date.now() - 5000;
          const reinforcementFactor = node.metadata.weight > 1.5;

          const material = getCachedMaterial(color, isRecentlyActive, node.metadata.frequency, node.metadata.weight);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.scale.set(size, size, size);
          
          // Animation without React state
          mesh.onBeforeRender = () => {
              if (isRecentlyActive || reinforcementFactor) {
                  const t = performance.now() * 0.002;
                  const intensity = cognitiveState?.arousal || 0.3;
                  const p = (Math.sin(t) + 1) / 2;
                  const pulseScale = 1 + p * (intensity * 0.2);
                  mesh.scale.set(size * pulseScale, size * pulseScale, size * pulseScale);
              }
          };

          group.add(mesh);

          if (node.metadata.frequency > 2) {
             const ringCount = Math.min(Math.floor(node.metadata.frequency / 3), 3);
             for(let i=0; i<ringCount; i++) {
                const ringSize = 1.3 + i*0.3;
                const r = new THREE.Mesh(
                    getCachedGeometry('cosmic'), 
                    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.25 - i*0.08 })
                );
                r.scale.set(size * ringSize / 1.2, size * ringSize / 1.2, size * ringSize / 1.2);
                r.rotation.x = Math.PI / (2 + i);
                r.rotation.y = Math.PI / (4 - i);
                group.add(r);
             }
          }

          const sprite = new SpriteText(node.id);
          sprite.color = '#ffffff'; 
          sprite.textHeight = 3 + (node.metadata.frequency * 0.4); 
          sprite.position.set(0, size + 6, 0); 
          sprite.fontFace = 'Courier New';
          sprite.backgroundColor = 'rgba(0,0,0,0.6)'; 
          sprite.padding = 3; 
          sprite.borderRadius = 4;
          group.add(sprite);
          
          return group;
        }}
        linkColor={(link: any) => link.type === 'cluster' ? 'rgba(0,0,0,0)' : (link.isActive ? '#22d3ee' : '#1e293b')} 
        linkWidth={(link: any) => link.isActive ? 1.5 : 1} 
        linkOpacity={(link: any) => link.isActive ? 0.8 : 0.08}
        linkDirectionalParticles={(link: any) => link.isActive ? 2 : 0} 
        linkDirectionalParticleWidth={1.5} 
        linkDirectionalParticleSpeed={0.004}
        onNodeClick={(node: any) => {
            const distance = 100; const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
            fgRef.current?.cameraPosition({ x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, { x: node.x, y: node.y, z: node.z }, 1500);
        }}
      />
    </div>
  );
};

export default ThoughtGraph3D;
