import type { StatsPayload } from '../vscode';

interface Props {
  stats: StatsPayload | null;
}

export function StatsPanel({ stats }: Props) {
  if (!stats) return <div className="stats-loading">Loading stats…</div>;

  const lastIndexed = stats.last_indexed
    ? new Date(stats.last_indexed).toLocaleString()
    : 'Never';

  const savingsK = (stats.token_savings_estimate / 1000).toFixed(1);
  const duration = stats.last_index_duration_ms
    ? `${stats.last_index_duration_ms}ms`
    : '—';

  return (
    <div className="stats-panel">
      <h2>Index Stats</h2>
      <div className="stats-grid">
        <Stat label="Nodes indexed" value={stats.node_count.toLocaleString()} />
        <Stat label="Edges indexed" value={stats.edge_count.toLocaleString()} />
        <Stat label="Last indexed" value={lastIndexed} />
        <Stat label="Index duration" value={duration} />
        <Stat label="Schema version" value={stats.schema_version} />
      </div>

      <h2>Efficiency</h2>
      <div className="stats-grid">
        <Stat label="MCP queries" value={stats.query_count.toLocaleString()} />
        <Stat label="Estimated token savings" value={`~${savingsK}K`} highlight />
        <Stat
          label="Avg tokens per query"
          value={stats.query_count > 0 ? Math.round(stats.token_savings_estimate / stats.query_count).toLocaleString() : '—'}
        />
      </div>

      <p className="stats-note">
        Token savings are estimated based on graph-context tokens served vs. estimated full-file reads.
      </p>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`stat-card ${highlight ? 'highlight' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
