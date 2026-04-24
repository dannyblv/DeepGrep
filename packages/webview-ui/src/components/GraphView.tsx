import { useEffect, useRef, useCallback } from 'react';
import Cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { CyNode, CyEdge } from '../vscode';

Cytoscape.use(fcose as Cytoscape.Ext);

const NODE_COLORS: Record<string, string> = {
  file: '#4a9eff',
  function: '#7ec8a4',
  class: '#f0a500',
  interface: '#9b8ec4',
  type: '#c48ec4',
  import: '#7a7a7a',
  variable: '#aaa',
};

interface Props {
  nodes: CyNode[];
  edges: CyEdge[];
  highlighted: { ids: string[]; color: 'ai' | 'error' | 'selected' } | null;
  onNodeClick: (nodeId: string) => void;
}

const HIGHLIGHT_COLORS = { ai: '#7ec8a4', error: '#ff5c5c', selected: '#4a9eff' };
const MAX_VISIBLE = 500;

export function GraphView({ nodes, edges, highlighted, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const visible = nodes.slice(0, MAX_VISIBLE);
    const visibleIds = new Set(visible.map(n => n.id));

    const cy = Cytoscape({
      container: containerRef.current,
      elements: [
        ...visible.map(n => ({
          data: { id: n.id, label: n.label, type: n.type, file: n.file },
        })),
        ...edges
          .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
          .map(e => ({
            data: { id: e.id, source: e.source, target: e.target, type: e.type },
          })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele) => NODE_COLORS[ele.data('type')] ?? '#888',
            label: 'data(label)',
            'font-size': 10,
            color: '#ddd',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            width: 20,
            height: 20,
          } as Cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#555',
            'target-arrow-color': '#555',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          } as Cytoscape.Css.Edge,
        },
        {
          selector: '.highlighted-ai',
          style: { 'background-color': HIGHLIGHT_COLORS.ai, 'border-width': 2, 'border-color': '#fff' } as Cytoscape.Css.Node,
        },
        {
          selector: '.highlighted-error',
          style: { 'background-color': HIGHLIGHT_COLORS.error, 'border-width': 2, 'border-color': '#fff' } as Cytoscape.Css.Node,
        },
        {
          selector: '.highlighted-selected',
          style: { 'background-color': HIGHLIGHT_COLORS.selected, 'border-width': 2, 'border-color': '#fff' } as Cytoscape.Css.Node,
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.15 } as Cytoscape.Css.Node,
        },
      ],
      layout: { name: 'fcose', animate: false, randomize: false } as Cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
    });

    cy.on('tap', 'node', (evt) => {
      onNodeClick(evt.target.id());
    });

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [nodes, edges]);

  // Apply highlights without re-rendering the whole graph
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().removeClass('highlighted-ai highlighted-error highlighted-selected dimmed');
    if (!highlighted || highlighted.ids.length === 0) return;

    const idSet = new Set(highlighted.ids);
    cy.nodes().forEach(node => {
      if (idSet.has(node.id())) {
        node.addClass(`highlighted-${highlighted.color}`);
      } else {
        node.addClass('dimmed');
      }
    });

    // Fit to highlighted nodes
    const targets = cy.nodes().filter(n => idSet.has(n.id()));
    if (targets.length) cy.fit(targets, 80);
  }, [highlighted]);

  return (
    <div className="graph-container">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {nodes.length > MAX_VISIBLE && (
        <div className="graph-notice">
          Showing {MAX_VISIBLE} of {nodes.length} nodes. Use search to focus.
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
