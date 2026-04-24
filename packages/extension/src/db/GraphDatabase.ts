import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface GraphNode {
  id: string;
  type: 'function' | 'class' | 'variable' | 'import' | 'file' | 'interface' | 'type';
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  language: string;
  code_snippet: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  type: 'calls' | 'imports' | 'extends' | 'uses' | 'exports' | 're-exports';
}

export interface AgentMemoryEntry {
  id: string;
  agent_id: string;
  node_id: string | null;
  key: string;
  value: string;
  created_at: number;
}

export interface Stats {
  node_count: number;
  edge_count: number;
  last_indexed: number | null;
  last_index_duration_ms: number | null;
  schema_version: string;
}

const SCHEMA_VERSION = '1';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL DEFAULT 0,
  end_line INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  code_snippet TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, type),
  FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  node_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id, key);
`;

export class GraphDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.ensureSchemaVersion();
  }

  private ensureSchemaVersion(): void {
    const existing = this.db
      .prepare<[], { value: string }>('SELECT value FROM index_metadata WHERE key = ?')
      .get('schema_version');
    if (!existing) {
      this.db
        .prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)')
        .run('schema_version', SCHEMA_VERSION);
    }
  }

  // ── Nodes ──────────────────────────────────────────────────────────────────

  upsertNode(node: GraphNode): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO nodes (id, type, name, file_path, start_line, end_line, language, code_snippet, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        node.id,
        node.type,
        node.name,
        node.file_path,
        node.start_line,
        node.end_line,
        node.language,
        node.code_snippet,
        JSON.stringify(node.metadata),
      );
  }

  upsertNodes(nodes: GraphNode[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, name, file_path, start_line, end_line, language, code_snippet, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((rows: GraphNode[]) => {
      for (const n of rows) {
        stmt.run(n.id, n.type, n.name, n.file_path, n.start_line, n.end_line, n.language, n.code_snippet, JSON.stringify(n.metadata));
      }
    });
    tx(nodes);
  }

  deleteNodesForFile(filePath: string): void {
    this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare<[string], Record<string, unknown>>('SELECT * FROM nodes WHERE id = ?').get(id);
    return row ? this.deserializeNode(row) : null;
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    const rows = this.db
      .prepare<[string, number], Record<string, unknown>>(
        "SELECT * FROM nodes WHERE name LIKE ? ORDER BY length(name) LIMIT ?",
      )
      .all(`%${query}%`, limit);
    return rows.map(r => this.deserializeNode(r));
  }

  getNodesForFile(filePath: string): GraphNode[] {
    return this.db
      .prepare<[string], Record<string, unknown>>('SELECT * FROM nodes WHERE file_path = ?')
      .all(filePath)
      .map(r => this.deserializeNode(r));
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  upsertEdge(edge: GraphEdge): void {
    this.db
      .prepare('INSERT OR IGNORE INTO edges (source_id, target_id, type) VALUES (?, ?, ?)')
      .run(edge.source_id, edge.target_id, edge.type);
  }

  upsertEdges(edges: GraphEdge[]): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, type) VALUES (?, ?, ?)');
    const tx = this.db.transaction((rows: GraphEdge[]) => {
      for (const e of rows) stmt.run(e.source_id, e.target_id, e.type);
    });
    tx(edges);
  }

  deleteEdgesForFile(filePath: string): void {
    this.db.prepare(`
      DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)
         OR target_id IN (SELECT id FROM nodes WHERE file_path = ?)
    `).run(filePath, filePath);
  }

  getOutgoing(nodeId: string): GraphEdge[] {
    return this.db
      .prepare<[string], GraphEdge>('SELECT * FROM edges WHERE source_id = ?')
      .all(nodeId);
  }

  getIncoming(nodeId: string): GraphEdge[] {
    return this.db
      .prepare<[string], GraphEdge>('SELECT * FROM edges WHERE target_id = ?')
      .all(nodeId);
  }

  /** BFS up to maxDepth hops from startId. Returns all visited node IDs. */
  getNeighbourhood(startId: string, maxDepth = 2): string[] {
    const visited = new Set<string>([startId]);
    let frontier = [startId];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const placeholders = frontier.map(() => '?').join(',');
      const outgoing = this.db
        .prepare<string[], { target_id: string }>(`SELECT target_id FROM edges WHERE source_id IN (${placeholders})`)
        .all(...frontier)
        .map(r => r.target_id);
      const incoming = this.db
        .prepare<string[], { source_id: string }>(`SELECT source_id FROM edges WHERE target_id IN (${placeholders})`)
        .all(...frontier)
        .map(r => r.source_id);
      frontier = [...outgoing, ...incoming].filter(id => !visited.has(id));
      frontier.forEach(id => visited.add(id));
    }
    visited.delete(startId);
    return Array.from(visited);
  }

  /** Full transitive dependency chain (callee direction only, capped at 50). */
  getDependencyChain(startId: string): string[] {
    const visited = new Set<string>();
    const stack = [startId];
    while (stack.length > 0 && visited.size < 50) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const deps = this.db
        .prepare<[string], { target_id: string }>('SELECT target_id FROM edges WHERE source_id = ?')
        .all(id)
        .map(r => r.target_id);
      stack.push(...deps);
    }
    visited.delete(startId);
    return Array.from(visited);
  }

  // ── Agent Memory ───────────────────────────────────────────────────────────

  setAgentMemory(agentId: string, key: string, value: string, nodeId: string | null = null): void {
    const id = `${agentId}:${key}`;
    this.db
      .prepare(`
        INSERT OR REPLACE INTO agent_memory (id, agent_id, node_id, key, value, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, agentId, nodeId, key, value, Date.now());
  }

  getAgentMemory(agentId: string, key: string): string | null {
    const row = this.db
      .prepare<[string, string], { value: string }>('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?')
      .get(agentId, key);
    return row?.value ?? null;
  }

  listAgentMemory(agentId: string): AgentMemoryEntry[] {
    return this.db
      .prepare<[string], AgentMemoryEntry>('SELECT * FROM agent_memory WHERE agent_id = ?')
      .all(agentId);
  }

  // ── Metadata / Stats ───────────────────────────────────────────────────────

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)').run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM index_metadata WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  getStats(): Stats {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    return {
      node_count: nodeCount,
      edge_count: edgeCount,
      last_indexed: this.getMeta('last_indexed') ? Number(this.getMeta('last_indexed')) : null,
      last_index_duration_ms: this.getMeta('last_index_duration_ms')
        ? Number(this.getMeta('last_index_duration_ms'))
        : null,
      schema_version: this.getMeta('schema_version') ?? SCHEMA_VERSION,
    };
  }

  getAllNodes(): GraphNode[] {
    return this.db
      .prepare<[], Record<string, unknown>>('SELECT * FROM nodes')
      .all()
      .map(r => this.deserializeNode(r));
  }

  getAllEdges(): GraphEdge[] {
    return this.db.prepare<[], GraphEdge>('SELECT * FROM edges').all();
  }

  private deserializeNode(row: Record<string, unknown>): GraphNode {
    return {
      ...(row as unknown as GraphNode),
      metadata: JSON.parse((row.metadata as string) ?? '{}'),
    };
  }

  close(): void {
    this.db.close();
  }
}
