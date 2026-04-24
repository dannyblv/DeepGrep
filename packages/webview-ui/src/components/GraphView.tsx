import { useEffect, useRef } from 'react';
import Cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { CyNode, CyEdge } from '../vscode';

Cytoscape.use(fcose as Cytoscape.Ext);

// ── Visual tokens ─────────────────────────────────────────────────────────────

const NODE_COLOR: Record<string, string> = {
  file:      '#4a9eff',
  function:  '#7ec8a4',
  class:     '#f0a500',
  interface: '#c084fc',
  type:      '#e879f9',
  import:    '#94a3b8',
  variable:  '#78716c',
};

const NODE_SIZE: Record<string, number> = {
  file:      44,
  class:     36,
  function:  28,
  interface: 26,
  type:      24,
  import:    20,
  variable:  18,
};

const NODE_SHAPE: Record<string, string> = {
  file:      'round-rectangle',
  class:     'hexagon',
  function:  'ellipse',
  interface: 'diamond',
  type:      'ellipse',
  import:    'tag',
  variable:  'ellipse',
};

// Edge color + line-style by relationship type
export const EDGE_STYLE: Record<string, { color: string; dash: string }> = {
  calls:        { color: '#4a9eff', dash: 'solid' },
  imports:      { color: '#f0a500', dash: 'dashed' },
  extends:      { color: '#c084fc', dash: 'solid' },
  exports:      { color: '#7ec8a4', dash: 'dotted' },
  uses:         { color: '#94a3b8', dash: 'dashed' },
  're-exports': { color: '#fb923c', dash: 'dashed' },
};

const HIGHLIGHT_COLORS = { ai: '#7ec8a4', error: '#ff5c5c', selected: '#4a9eff' };
const MAX_VISIBLE = 500;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  nodes: CyNode[];
  edges: CyEdge[];
  highlighted: { ids: string[]; color: 'ai' | 'error' | 'selected' } | null;
  onNodeClick: (nodeId: string) => void;
}

export function GraphView({ nodes, edges, highlighted, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Cytoscape.Core | null>(null);
  const highlightedRef = useRef(highlighted);
  highlightedRef.current = highlighted;

  useEffect(() => {
    if (!containerRef.current) return;

    const visible = nodes.slice(0, MAX_VISIBLE);
    const visibleIds = new Set(visible.map(n => n.id));
    const visibleEdges = edges.filter(
      e => visibleIds.has(e.source) && visibleIds.has(e.target) && e.source !== e.target,
    );

    const cy = Cytoscape({
      container: containerRef.current,
      elements: [
        ...visible.map(n => ({
          data: { id: n.id, label: n.label, type: n.type, file: n.file },
        })),
        ...visibleEdges.map(e => ({
          data: { id: e.id, source: e.source, target: e.target, type: e.type },
        })),
      ],

      style: [
        // ── Nodes ─────────────────────────────────────────────────────────
        {
          selector: 'node',
          style: {
            'background-color': (el) => NODE_COLOR[el.data('type')] ?? '#888',
            shape: (el) => (NODE_SHAPE[el.data('type')] ?? 'ellipse') as Cytoscape.Css.PropertyValue<Cytoscape.Css.Node, 'shape'>,
            width:  (el) => NODE_SIZE[el.data('type')] ?? 24,
            height: (el) => NODE_SIZE[el.data('type')] ?? 24,
            // Label
            label: 'data(label)',
            'font-size': 11,
            color: '#e2e8f0',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            'text-max-width': '110px',
            'text-overflow-wrap': 'anywhere' as Cytoscape.Css.PropertyValue<Cytoscape.Css.Node, 'text-overflow-wrap'>,
            // Pill background so label is always legible over other nodes
            'text-background-color': '#12121a',
            'text-background-opacity': 0.78,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle' as Cytoscape.Css.PropertyValue<Cytoscape.Css.Node, 'text-background-shape'>,
            // Subtle border matching fill
            'border-width': 2,
            'border-color': (el) => NODE_COLOR[el.data('type')] ?? '#888',
            'border-opacity': 0.35,
            'z-index': 1,
          } as Cytoscape.Css.Node,
        },
        // File nodes get bolder label
        {
          selector: 'node[type="file"]',
          style: { 'font-size': 12, 'font-weight': '600' } as Cytoscape.Css.Node,
        },

        // ── Edges ─────────────────────────────────────────────────────────
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            width: 1.8,
            'line-color':          (el) => EDGE_STYLE[el.data('type')]?.color ?? '#666',
            'target-arrow-color':  (el) => EDGE_STYLE[el.data('type')]?.color ?? '#666',
            'target-arrow-shape':  'triangle',
            'arrow-scale': 1.5,
            'line-style': (el) => (EDGE_STYLE[el.data('type')]?.dash ?? 'solid') as Cytoscape.Css.PropertyValue<Cytoscape.Css.Edge, 'line-style'>,
            opacity: 0.65,
            'z-index': 0,
          } as Cytoscape.Css.Edge,
        },

        // ── Hover ──────────────────────────────────────────────────────────
        {
          selector: 'node.hover-focus',
          style: {
            'border-width': 3,
            'border-opacity': 1,
            opacity: 1,
            'z-index': 20,
          } as Cytoscape.Css.Node,
        },
        {
          selector: 'edge.hover-edge',
          style: {
            width: 2.8,
            opacity: 1,
            'z-index': 15,
            // Show edge type as inline label on hover
            label: 'data(type)',
            'font-size': 9,
            color: '#e2e8f0',
            'text-background-color': '#12121a',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle' as Cytoscape.Css.PropertyValue<Cytoscape.Css.Edge, 'text-background-shape'>,
            'text-rotation': 'autorotate',
          } as Cytoscape.Css.Edge,
        },
        {
          selector: 'node.hover-neighbor',
          style: {
            'border-width': 2,
            'border-opacity': 0.8,
            opacity: 1,
            'z-index': 10,
          } as Cytoscape.Css.Node,
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.1 } as Cytoscape.Css.Node,
        },
        {
          selector: 'edge.dimmed',
          style: { opacity: 0.05 } as Cytoscape.Css.Edge,
        },

        // ── Highlighted ───────────────────────────────────────────────────
        {
          selector: '.highlighted-ai',
          style: { 'background-color': HIGHLIGHT_COLORS.ai, 'border-width': 3, 'border-color': '#fff', 'border-opacity': 0.9 } as Cytoscape.Css.Node,
        },
        {
          selector: '.highlighted-error',
          style: { 'background-color': HIGHLIGHT_COLORS.error, 'border-width': 3, 'border-color': '#fff', 'border-opacity': 0.9 } as Cytoscape.Css.Node,
        },
        {
          selector: '.highlighted-selected',
          style: { 'background-color': HIGHLIGHT_COLORS.selected, 'border-width': 3, 'border-color': '#fff', 'border-opacity': 0.9 } as Cytoscape.Css.Node,
        },
      ],

      // ── Layout ────────────────────────────────────────────────────────────
      layout: {
        name: 'fcose',
        animate: true,
        animationDuration: 700,
        animationEasing: 'ease-out',
        randomize: true,
        quality: 'proof',
        // Primary spacing levers
        nodeRepulsion: 14000,
        idealEdgeLength: 160,
        // Spring + gravity
        edgeElasticity: 0.45,
        gravity: 0.2,
        gravityRange: 3.8,
        // More iterations → better separation
        numIter: 2500,
        // Disconnected clusters get tiled with padding
        tile: true,
        tilingPaddingVertical: 40,
        tilingPaddingHorizontal: 40,
        padding: 50,
      } as Cytoscape.LayoutOptions,

      wheelSensitivity: 0.3,
      minZoom: 0.05,
      maxZoom: 4,
    });

    // ── Hover interactions ─────────────────────────────────────────────────
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as Cytoscape.NodeSingular;
      const connectedEdges = node.connectedEdges();
      const neighbors = connectedEdges.connectedNodes().not(node);
      // Dim everything else
      cy.elements().addClass('dimmed');
      node.removeClass('dimmed').addClass('hover-focus');
      connectedEdges.removeClass('dimmed').addClass('hover-edge');
      neighbors.removeClass('dimmed').addClass('hover-neighbor');
    });

    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('dimmed hover-focus hover-edge hover-neighbor');
      // Re-apply any active highlight state
      const h = highlightedRef.current;
      if (h?.ids.length) {
        const idSet = new Set(h.ids);
        cy.nodes().forEach(n => {
          if (!idSet.has(n.id())) n.addClass('dimmed');
        });
        cy.edges().forEach(e => e.addClass('dimmed'));
      }
    });

    cy.on('tap', 'node', (evt) => onNodeClick(evt.target.id()));

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [nodes, edges]);

  // Apply/clear highlights without full re-render
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('highlighted-ai highlighted-error highlighted-selected dimmed');
    if (!highlighted?.ids.length) return;
    const idSet = new Set(highlighted.ids);
    cy.nodes().forEach(n => {
      if (idSet.has(n.id())) n.addClass(`highlighted-${highlighted.color}`);
      else n.addClass('dimmed');
    });
    cy.edges().forEach(e => e.addClass('dimmed'));
    const targets = cy.nodes().filter(n => idSet.has(n.id()));
    if (targets.length) cy.fit(targets, 100);
  }, [highlighted]);

  return (
    <div className="graph-container">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Edge-type legend */}
      <div className="graph-legend">
        {Object.entries(EDGE_STYLE).map(([type, { color, dash }]) => (
          <span key={type} className="legend-item">
            <svg width="22" height="8" className="legend-line">
              <line
                x1="0" y1="4" x2="22" y2="4"
                stroke={color}
                strokeWidth="2"
                strokeDasharray={dash === 'dashed' ? '4,2' : dash === 'dotted' ? '2,2' : undefined}
              />
              <polygon points="16,1 22,4 16,7" fill={color} />
            </svg>
            {type}
          </span>
        ))}
      </div>

      {nodes.length > MAX_VISIBLE && (
        <div className="graph-notice">
          Showing {MAX_VISIBLE} of {nodes.length} nodes — use search to focus.
        </div>
      )}
      {nodes.length === 0 && (
        <div className="graph-empty">
          <p>No index yet.</p>
          <p>Click <strong>Re-index</strong> or save a source file to start.</p>
        </div>
      )}
    </div>
  );
}
