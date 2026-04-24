import type { CyNode } from '../vscode';

interface Props {
  data: CyNode & { snippet: string; callers: CyNode[]; callees: CyNode[] };
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

export function NodeDetail({ data, onClose, onNavigate }: Props) {
  return (
    <aside className="node-detail">
      <header>
        <span className={`node-type-badge type-${data.type}`}>{data.type}</span>
        <strong>{data.label}</strong>
        <button className="close-btn" onClick={onClose}>✕</button>
      </header>

      <div className="node-file">
        {data.file}:{data.line}
      </div>

      {data.snippet && (
        <pre className="node-snippet">{data.snippet}</pre>
      )}

      {data.callers.length > 0 && (
        <section>
          <h4>Callers ({data.callers.length})</h4>
          <ul>
            {data.callers.map(c => (
              <li key={c.id}>
                <button className="node-link" onClick={() => onNavigate(c.id)}>
                  {c.label}
                  <span className="node-link-file">{c.file}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.callees.length > 0 && (
        <section>
          <h4>Calls ({data.callees.length})</h4>
          <ul>
            {data.callees.map(c => (
              <li key={c.id}>
                <button className="node-link" onClick={() => onNavigate(c.id)}>
                  {c.label}
                  <span className="node-link-file">{c.file}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
