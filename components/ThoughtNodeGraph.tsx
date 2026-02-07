import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Thought, Language } from '../types';
import { translations } from '../translations';

interface ThoughtNodeGraphProps {
  thoughts: Thought[];
  language?: Language;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  type: Thought['type'];
  timestamp: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

const ThoughtNodeGraph: React.FC<ThoughtNodeGraphProps> = ({ thoughts, language = 'ru' }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null); // Ref for the group that will be transformed
  const t = translations[language];

  useEffect(() => {
    if (!containerRef.current || !svgRef.current || thoughts.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    
    // Clear previous elements but keep the <defs> and main <g> if they exist, 
    // actually safer to clear all and rebuild for React strict mode consistency
    svg.selectAll("*").remove(); 

    // 1. Define Gradients for Abstract/Glowing look
    const defs = svg.append("defs");

    const createGradient = (id: string, color: string) => {
      const radialGradient = defs.append("radialGradient")
        .attr("id", id)
        .attr("cx", "50%")
        .attr("cy", "50%")
        .attr("r", "50%")
        .attr("fx", "50%")
        .attr("fy", "50%");

      radialGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", color)
        .attr("stop-opacity", 1);

      radialGradient.append("stop")
        .attr("offset", "70%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.3);
        
      radialGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0);
    };

    createGradient("grad-seed", "#22d3ee");      // Cyan
    createGradient("grad-evolution", "#818cf8"); // Indigo
    createGradient("grad-divergence", "#f472b6");// Pink
    createGradient("grad-conclusion", "#34d399");// Emerald

    // 2. Main Group for Zooming
    const g = svg.append("g").attr("class", "graph-container");

    // 3. Setup Zoom Behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4]) // Min and max zoom
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom)
       .on("dblclick.zoom", null); // Disable double click zoom

    // Prepare Data
    // We try to preserve positions of existing nodes if re-rendering
    const nodes: Node[] = thoughts.map(t => ({
      id: t.id,
      type: t.type,
      timestamp: t.timestamp,
      x: width / 2 + (Math.random() - 0.5) * 50, // Slight jitter for initial placement
      y: height / 2 + (Math.random() - 0.5) * 50
    }));

    const links: Link[] = [];
    for (let i = 1; i < thoughts.length; i++) {
      links.push({
        source: thoughts[i - 1].id,
        target: thoughts[i].id
      });
    }

    // Colors Map (for strokes/solid fallback)
    const colorMap: Record<string, string> = {
      'seed': '#22d3ee',
      'evolution': '#818cf8',
      'divergence': '#f472b6',
      'conclusion': '#34d399'
    };

    // 4. Ambient Particles (Background abstract noise)
    // Create random static particles to give depth
    const particleCount = 20;
    const particlesData = Array.from({ length: particleCount }).map(() => ({
        x: Math.random() * width * 2 - width / 2, // Spread wider
        y: Math.random() * height * 2 - height / 2,
        r: Math.random() * 2 + 1,
        opacity: Math.random() * 0.3
    }));

    g.append("g")
     .selectAll("circle")
     .data(particlesData)
     .join("circle")
     .attr("cx", d => d.x)
     .attr("cy", d => d.y)
     .attr("r", d => d.r)
     .attr("fill", "#64748b")
     .attr("opacity", d => d.opacity);


    // 5. Simulation Setup
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(80)) // Increased distance for breathability
      .force("charge", d3.forceManyBody().strength(-150)) // Repel
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.05)) // Gentle centering
      .force("collide", d3.forceCollide().radius(15));

    // 6. Draw Links (Organic thin lines)
    const link = g.append("g")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.2) // Very faint
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1);

    // 7. Draw Nodes (Glowing Orbs)
    const node = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 12) // Larger radius because of the soft gradient edge
      .attr("fill", (d) => `url(#grad-${d.type})`)
      .attr("cursor", "grab")
      .call(drag(simulation) as any);

    // Solid core for the node
    const nodeCore = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 3)
      .attr("fill", "#fff")
      .attr("fill-opacity", 0.8)
      .style("pointer-events", "none"); // Let events pass to the larger circle

    // Pulse for the active (last) node
    if (nodes.length > 0) {
        const lastNode = nodes[nodes.length - 1];
        const pulse = g.append("circle")
           .attr("cx", 0) 
           .attr("cy", 0)
           .attr("r", 12)
           .attr("fill", "none")
           .attr("stroke", colorMap[lastNode.type])
           .attr("stroke-width", 1)
           .attr("opacity", 0.8)
           .attr("class", "last-node-pulse");

        pulse.transition()
           .duration(2000)
           .ease(d3.easeCubicOut)
           .attr("r", 40)
           .attr("stroke-opacity", 0)
           .on("end", function repeat() {
                d3.select(this)
                    .attr("r", 12)
                    .attr("stroke-opacity", 0.8)
                    .transition()
                    .duration(2000)
                    .attr("r", 40)
                    .attr("stroke-opacity", 0)
                    .on("end", repeat);
           });
    }

    // Tick Function
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);
      
      nodeCore
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);
      
      // Update pulse position
      if (nodes.length > 0) {
         const lastDataNode = nodes[nodes.length - 1];
         svg.select(".last-node-pulse")
            .attr("cx", (lastDataNode as any).x)
            .attr("cy", (lastDataNode as any).y);
      }
    });

    return () => {
      simulation.stop();
    };
  }, [thoughts]);

  // Drag behavior definition
  const drag = (simulation: d3.Simulation<Node, undefined>) => {
    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
      d3.select(event.sourceEvent.target).attr("cursor", "grabbing");
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
      d3.select(event.sourceEvent.target).attr("cursor", "grab");
    }

    return d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  };

  return (
    <div ref={containerRef} className="w-full h-full min-h-[300px] bg-slate-900/50 rounded-lg overflow-hidden border border-slate-800 relative group">
        <div className="absolute top-4 left-4 text-xs font-mono text-slate-500 uppercase tracking-widest pointer-events-none z-10 flex flex-col gap-1">
            <span>{t.neuralMap}</span>
            <span className="text-[10px] text-slate-600 normal-case">{t.graphControls}</span>
        </div>
      <svg ref={svgRef} className="w-full h-full cursor-move" />
    </div>
  );
};

export default ThoughtNodeGraph;