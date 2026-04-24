import type { CyNode, CyEdge } from '../vscode';

interface Props {
  nodes: CyNode[];
  edges: CyEdge[];
  onNodeClick: (nodeId: string) => void;
}

const TYPE_ORDER = ['file', 'class', 'function', 'interface', 'type', 'import', 'variable'];

export function GraphSummary({ nodes, edges, onNodeClick }: Props) {
  // Type breakdown
  const typeCounts = new Map<string, number>();
  for (const n of nodes) {
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);
  }
  const sortedTypes = [...typeCounts.entries()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99),
  );

  // Top 5 hub nodes by total degree (in + out)
  const degreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }
  const topNodes = nodes
    .map(n => ({ node: n, degree: degreeMap.get(n.id) ?? 0 }))
    .filter(x => x.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5);

  return (
    <aside className="graph-summary">
      <div className="summary-section">
        <div className="summary-heading">Index overview</div>
        <div className="summary-total-count">
          {nodes.length.toLocaleString()} nodes &middot; {edges.length.toLocaleString()} edges
        </div>
        <div className="type-pills">
          {sortedTypes.map(([type, count]) => (
            <span key={type} className={`type-pill type-pill-${type}`}>
              <span className="type-pill-count">{count}</span>
              <span className="type-pill-label">{type}</span>
            </span>
          ))}
        </div>
      </div>

      {topNodes.length > 0 && (
        <div className="summary-section">
          <div className="summary-heading">
            Hub nodes
            <span className="summary-heading-hint">most connections</span>
          </div>
          <ul className="hub-list">
            {topNodes.map(({ node, degree }) => (
              <li key={node.id}>
                <button className="hub-item" onClick={() => onNodeClick(node.id)} title={node.file}>
                  <span className={`node-type-badge type-${node.type}`}>{node.type[0].toUpperCase()}</span>
                  <span className="hub-name">{node.label}</span>
                  <span className="hub-degree" title={`${degree} connections`}>{degree}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
