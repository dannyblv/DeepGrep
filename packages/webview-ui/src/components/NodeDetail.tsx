import { useState, useEffect, useRef } from 'react';
import type { CyNode } from '../vscode';
import { postMessage } from '../vscode';

interface Props {
  data: CyNode & { snippet: string; callers: CyNode[]; callees: CyNode[] };
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

export function NodeDetail({ data, onClose, onNavigate }: Props) {
  const [width, setWidth] = useState(280);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX; // drag left = wider
      setWidth(Math.max(200, Math.min(560, startW.current + delta)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    e.preventDefault();
  };

  return (
    <aside className="node-detail" style={{ width }}>
      <div className="nd-resize-handle" onMouseDown={startDrag} title="Drag to resize" />

      <header>
        <span className={`node-type-badge type-${data.type}`}>{data.type}</span>
        <strong className="nd-name">{data.label}</strong>
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
              <li key={c.id} className="nd-ref-row">
                <button className="node-link" onClick={() => onNavigate(c.id)}>
                  <span className="node-link-label">{c.label}</span>
                  <span className="node-link-file">{c.file}</span>
                </button>
                <button
                  className="nd-open-btn"
                  title={`Open ${c.file}:${c.line} in editor`}
                  onClick={() => postMessage({ type: 'openFile', nodeId: c.id })}
                >
                  ↗
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
              <li key={c.id} className="nd-ref-row">
                <button className="node-link" onClick={() => onNavigate(c.id)}>
                  <span className="node-link-label">{c.label}</span>
                  <span className="node-link-file">{c.file}</span>
                </button>
                <button
                  className="nd-open-btn"
                  title={`Open ${c.file}:${c.line} in editor`}
                  onClick={() => postMessage({ type: 'openFile', nodeId: c.id })}
                >
                  ↗
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
