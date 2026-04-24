import { useState, useEffect, useRef, useMemo } from 'react';
import { GraphView } from './components/GraphView';
import { StatsPanel } from './components/StatsPanel';
import { NodeDetail } from './components/NodeDetail';
import { GraphSummary } from './components/GraphSummary';
import { OnboardingView } from './components/OnboardingView';
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
  const [graphReady, setGraphReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusId, setSearchFocusId] = useState<string | null>(null);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onMessage((msg: ExtToWebviewMsg) => {
      switch (msg.type) {
        case 'graphUpdate':
          setNodes(msg.nodes);
          setEdges(msg.edges);
          setIndexing(null);
          setGraphReady(true);
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

    postMessage({ type: 'ready' });
    return unsub;
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return nodes
      .filter(n => n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q))
      .slice(0, 10);
  }, [searchQuery, nodes]);

  const handleSearchSelect = (nodeId: string) => {
    setSearchFocusId(nodeId);
    setSearchQuery('');
    setSearchFocused(false);
  };

  const showingOnboarding = graphReady && nodes.length === 0;

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

      {tab === 'graph' && nodes.length > 0 && (
        <div className="search-wrap">
          <input
            type="text"
            className="search-input"
            placeholder="Search nodes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          />
          {searchFocused && searchResults.length > 0 && (
            <div className="search-dropdown">
              {searchResults.map(n => (
                <button
                  key={n.id}
                  className="search-result"
                  onMouseDown={() => handleSearchSelect(n.id)}
                >
                  <span className={`node-type-badge type-${n.type}`}>{n.type[0].toUpperCase()}</span>
                  <span className="search-result-label">{n.label}</span>
                  <span className="search-result-file">{n.file.split('/').pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
        {tab === 'graph' && !graphReady && !showingOnboarding && (
          <div className="graph-loading">
            <span className="graph-loading-hex">⬡</span>
            <span>Loading graph…</span>
          </div>
        )}
        {tab === 'graph' && showingOnboarding && (
          <OnboardingView />
        )}
        {tab === 'graph' && graphReady && !showingOnboarding && nodes.length > 0 && (
          <div className="graph-layout">
            <GraphView
              nodes={nodes}
              edges={edges}
              highlighted={highlighted}
              onNodeClick={(nodeId) => { setSearchFocusId(null); postMessage({ type: 'nodeNavigate', nodeId }); }}
              searchFocusId={searchFocusId}
              onBgTap={() => { setSearchFocusId(null); setHighlighted(null); }}
            />
            {detail ? (
              <NodeDetail
                data={detail.node}
                onClose={() => setDetail(null)}
                onNavigate={(nodeId) => { setSearchFocusId(nodeId); postMessage({ type: 'nodeNavigate', nodeId }); }}
                onFileClick={(file) => {
                  setSearchFocusId(null);
                  const ids = nodes.filter(n => n.file === file).map(n => n.id);
                  setHighlighted(ids.length ? { ids, color: 'selected' } : null);
                }}
              />
            ) : nodes.length > 0 ? (
              <GraphSummary
                nodes={nodes}
                edges={edges}
                onNodeClick={(nodeId) => postMessage({ type: 'nodeNavigate', nodeId })}
              />
            ) : null}
          </div>
        )}
        {tab === 'stats' && <StatsPanel stats={stats} />}
      </main>
    </div>
  );
}
