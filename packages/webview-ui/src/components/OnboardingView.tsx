const STEPS = [
  {
    n: 1,
    title: 'Index your workspace',
    desc: 'Click Re-index above. Builds an AST-derived dependency graph of your entire codebase in seconds.',
  },
  {
    n: 2,
    title: 'Use Claude Code normally',
    desc: 'Claude automatically queries the graph via the MCP server for structural context — no changes to your workflow.',
  },
  {
    n: 3,
    title: 'Explore this panel',
    desc: 'Click any node to inspect its code, callers, and callees. Hub nodes show the most-connected symbols.',
  },
];

const BENEFITS = [
  {
    icon: '⚡',
    title: 'Faster answers',
    desc: 'Graph-ranked context served in milliseconds vs full-file scans',
    tag: 'ms latency',
  },
  {
    icon: '🎯',
    title: 'Better precision',
    desc: 'Structural AST search — finds the exact symbol, not nearby text',
    tag: 'AST-exact',
  },
  {
    icon: '💰',
    title: '70–80% fewer tokens',
    desc: 'Serve exact symbols and their call-sites, not entire files',
    tag: '~70–80% less',
  },
  {
    icon: '🔗',
    title: 'Cross-file context',
    desc: 'Automatically traces imports, calls, extends, and re-exports',
    tag: 'auto-traced',
  },
];

interface Props {
  canClose?: boolean;
  onClose?: () => void;
}

export function OnboardingView({ canClose, onClose }: Props) {
  return (
    <div className="ob-panel">
      {canClose && (
        <button className="ob-close-btn" onClick={onClose} title="Close guide">✕</button>
      )}
      <div className="ob-hero">
        <div className="ob-hex">⬡</div>
        <h1 className="ob-heading">DeepGrep</h1>
        <p className="ob-tagline">AST-powered structural context for Claude Code</p>
      </div>

      <section className="ob-section">
        <h2 className="ob-section-title">Get started in 3 steps</h2>
        <div className="ob-steps">
          {STEPS.map(({ n, title, desc }) => (
            <div key={n} className="ob-step">
              <div className="ob-step-num">{n}</div>
              <div className="ob-step-body">
                <strong>{title}</strong>
                <p>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ob-section">
        <h2 className="ob-section-title">Why DeepGrep?</h2>
        <div className="ob-benefits">
          {BENEFITS.map(({ icon, title, desc, tag }) => (
            <div key={title} className="ob-benefit">
              <span className="ob-benefit-icon">{icon}</span>
              <div className="ob-benefit-body">
                <div className="ob-benefit-header">
                  <strong>{title}</strong>
                  <span className="ob-benefit-tag">{tag}</span>
                </div>
                <p>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
