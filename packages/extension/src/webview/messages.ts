/** Serializable Cytoscape node/edge data */
export interface CyNode {
  id: string;
  label: string;
  type: string;
  file: string;
  line: number;
}

export interface CyEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface StatsPayload {
  node_count: number;
  edge_count: number;
  last_indexed: number | null;
  last_index_duration_ms: number | null;
  schema_version: string;
  token_savings_estimate: number;
  query_count: number;
}

// ── Webview → Extension ──────────────────────────────────────────────────────
export type WebviewToExtMsg =
  | { type: 'ready' }
  | { type: 'nodeClick'; nodeId: string }
  | { type: 'requestHighlight'; nodeIds: string[] }
  | { type: 'requestStats' }
  | { type: 'requestReindex' };

// ── Extension → Webview ──────────────────────────────────────────────────────
export type ExtToWebviewMsg =
  | { type: 'graphUpdate'; nodes: CyNode[]; edges: CyEdge[] }
  | { type: 'highlight'; nodeIds: string[]; color: 'ai' | 'error' | 'selected' }
  | { type: 'stats'; data: StatsPayload }
  | { type: 'indexing'; progress: number; message: string }
  | { type: 'nodeDetail'; node: CyNode & { snippet: string; callers: CyNode[]; callees: CyNode[] } }
  | { type: 'toolQuery'; toolName: string };
