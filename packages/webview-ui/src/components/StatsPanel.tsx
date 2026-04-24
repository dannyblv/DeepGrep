import type { StatsPayload } from '../vscode';

interface Props {
  stats: StatsPayload | null;
}

const EFFICIENCY_GAINS = [
  { label: 'Token reduction', value: '70–80%', colorClass: 'green', desc: 'vs full-file context' },
  { label: 'Search precision', value: 'AST-exact', colorClass: 'blue', desc: 'structural, not textual' },
  { label: 'Context quality', value: 'Symbol-level', colorClass: 'yellow', desc: 'callers + callees included' },
  { label: 'Cross-file tracing', value: 'Automatic', colorClass: 'purple', desc: 'imports, calls, extends' },
];

export function StatsPanel({ stats }: Props) {
  if (!stats) return <div className="stats-loading">Loading stats…</div>;

  const savingsK = Math.round((stats.token_savings_estimate || 0) / 1000);
  const avgPerQuery =
    stats.query_count > 0 ? Math.round(stats.token_savings_estimate / stats.query_count) : 0;
  const impactPct = Math.min(100, Math.round((stats.token_savings_estimate || 0) / 2000));
  const density =
    stats.node_count > 0 ? (stats.edge_count / stats.node_count).toFixed(2) : null;

  const lastIndexed = stats.last_indexed
    ? new Date(stats.last_indexed).toLocaleString()
    : 'Never';
  const duration = stats.last_index_duration_ms ? `${stats.last_index_duration_ms}ms` : '—';

  return (
    <div className="stats-panel">

      {/* Summary strip */}
      <div className="stats-strip">
        <div className="stats-strip-item">
          <span className="stats-strip-val green">{stats.node_count.toLocaleString()}</span>
          <span className="stats-strip-lbl">nodes</span>
        </div>
        <div className="stats-strip-sep" />
        <div className="stats-strip-item">
          <span className="stats-strip-val blue">{stats.edge_count.toLocaleString()}</span>
          <span className="stats-strip-lbl">edges</span>
        </div>
        <div className="stats-strip-sep" />
        <div className="stats-strip-item">
          <span className="stats-strip-val accent">~{savingsK}k</span>
          <span className="stats-strip-lbl">tokens saved</span>
        </div>
        {density && (
          <>
            <div className="stats-strip-sep" />
            <div className="stats-strip-item">
              <span className="stats-strip-val">{density}</span>
              <span className="stats-strip-lbl">edges/node</span>
            </div>
          </>
        )}
      </div>

      {/* Index section */}
      <h2>Index</h2>
      <div className="stats-grid">
        <Stat label="Nodes indexed" value={stats.node_count.toLocaleString()} />
        <Stat label="Edges indexed" value={stats.edge_count.toLocaleString()} />
        <Stat label="Last indexed" value={lastIndexed} />
        <Stat label="Index duration" value={duration} />
        <Stat label="Schema version" value={stats.schema_version} />
        {density && <Stat label="Graph density" value={`${density} e/n`} />}
      </div>

      {/* Prompt Impact section */}
      <h2>Prompt Impact</h2>
      <div className="stats-impact">
        <div className="stats-impact-bar-bg">
          <div className="stats-impact-bar-fill" style={{ width: `${impactPct}%` }} />
        </div>
        <div className="stats-impact-label">
          {savingsK > 0
            ? `~${savingsK}k tokens saved across ${stats.query_count} quer${stats.query_count === 1 ? 'y' : 'ies'}`
            : 'No MCP queries yet — ask Claude about your code'}
        </div>
      </div>
      <div className="stats-grid">
        <Stat label="MCP queries" value={stats.query_count.toLocaleString()} />
        <Stat label="Tokens saved" value={savingsK > 0 ? `~${savingsK}k` : '—'} highlight />
        <Stat
          label="Avg per query"
          value={avgPerQuery > 0 ? `~${avgPerQuery.toLocaleString()}t` : '—'}
        />
      </div>

      {/* Efficiency Gains section */}
      <h2>Efficiency Gains</h2>
      <div className="stats-gains">
        {EFFICIENCY_GAINS.map(({ label, value, colorClass, desc }) => (
          <div key={label} className="stats-gain-row">
            <div className="stats-gain-left">
              <span className={`stats-gain-val ${colorClass}`}>{value}</span>
              <span className="stats-gain-desc">{desc}</span>
            </div>
            <span className="stats-gain-label">{label}</span>
          </div>
        ))}
      </div>

      <p className="stats-note">
        Token savings are estimated based on graph-context tokens served vs. estimated full-file
        reads.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat-card ${highlight ? 'highlight' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
