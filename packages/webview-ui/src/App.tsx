import { useState, useEffect, useRef } from 'react';
import { GraphView } from './components/GraphView';
import { StatsPanel } from './components/StatsPanel';
import { NodeDetail } from './components/NodeDetail';
import { GraphSummary } from './components/GraphSummary';
import { postMessage, onMessage } from './vscode';
import type { CyNode, CyEdge, StatsPayload, ExtToWebviewMsg } from './vscode';

type Tab = 'graph' | 'stats';

interface NodeDetailData {
  node: CyNode & { snippet: string; callers: CyNode[]; callees: CyNode[] };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('graph');
  const [nodes, setNodes] = useState<CyNode[]>([]);
  const [edges, setEdges] = useState<CyEdge[]>([]);
  const [highlighted, setHighlighted] = useState<{ ids: string[]; color: 'ai' | 'error' | 'selected' } | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [detail, setDetail] = useState<NodeDetailData | null>(null);
  const [indexing, setIndexing] = useState<{ progress: number; message: string } | null>(null);
  const [activeQuery, setActiveQuery] = useState<{ tool: string; fading: boolean } | null>(null);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onMessage((msg: ExtToWebviewMsg) => {
      switch (msg.type) {
        case 'graphUpdate':
          setNodes(msg.nodes);
          setEdges(msg.edges);
          setIndexing(null);
          break;
        case 'highlight':
          setHighlighted({ ids: msg.nodeIds, color: msg.color });
          if (msg.color === 'error') setTab('graph');
          break;
        case 'stats':
          setStats(msg.data);
          break;
        case 'nodeDetail':
          setDetail({ node: msg.node });
          break;
        case 'indexing':
          setIndexing({ progress: msg.progress, message: msg.message });
          break;
        case 'toolQuery':
          if (queryTimer.current) clearTimeout(queryTimer.current);
          setActiveQuery({ tool: msg.toolName, fading: false });
          queryTimer.current = setTimeout(() => {
            setActiveQuery(q => q ? { ...q, fading: true } : null);
            queryTimer.current = setTimeout(() => setActiveQuery(null), 400);
          }, 1800);
          break;
      }
    });

    // Signal ready to the extension
    postMessage({ type: 'ready' });
    return unsub;
  }, []);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="logo">
          <span className={`logo-hex${activeQuery ? ' querying' : ''}`}>⬡</span>
          {' DeepGrep'}
          {activeQuery && (
            <span className={`query-badge${activeQuery.fading ? ' fading' : ''}`}>
              {activeQuery.tool}
            </span>
          )}
        </span>
        <nav>
          <button className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>
            Graph
          </button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => { setTab('stats'); postMessage({ type: 'requestStats' }); }}>
            Stats
          </button>
        </nav>
        <button className="reindex-btn" onClick={() => postMessage({ type: 'requestReindex' })}>
          Re-index
        </button>
      </header>

      {indexing && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${indexing.progress}%` }} />
          <span className="progress-label">
            <span className="progress-pct">{indexing.progress}%</span>
            {indexing.message}
          </span>
        </div>
      )}

      <main className="content">
        {tab === 'graph' && (
          <div className="graph-layout">
            <GraphView
              nodes={nodes}
              edges={edges}
              highlighted={highlighted}
              onNodeClick={(nodeId) => postMessage({ type: 'nodeClick', nodeId })}
            />
            {detail ? (
              <NodeDetail
                data={detail.node}
                onClose={() => setDetail(null)}
                onNavigate={(nodeId) => postMessage({ type: 'nodeClick', nodeId })}
              />
            ) : nodes.length > 0 ? (
              <GraphSummary
                nodes={nodes}
                edges={edges}
                onNodeClick={(nodeId) => postMessage({ type: 'nodeClick', nodeId })}
              />
            ) : null}
          </div>
        )}
        {tab === 'stats' && <StatsPanel stats={stats} />}
      </main>
    </div>
  );
}
