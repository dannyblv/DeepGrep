import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface GraphNode {
  id: string;
  type: string;
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
  type: string;
}

/** Read-only subset of GraphDatabase for the MCP server process. */
export class GraphDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath, { readonly: false });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL DEFAULT 0, end_line INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT '', code_snippet TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS edges (
        source_id TEXT NOT NULL, target_id TEXT NOT NULL, type TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, type)
      );
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, node_id TEXT,
        key TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
    `);
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare<[string], Record<string, unknown>>('SELECT * FROM nodes WHERE id = ?').get(id);
    return row ? this.deser(row) : null;
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    return this.db
      .prepare<[string, number], Record<string, unknown>>("SELECT * FROM nodes WHERE name LIKE ? ORDER BY length(name) LIMIT ?")
      .all(`%${query}%`, limit)
      .map(r => this.deser(r));
  }

  getNodesForFile(filePath: string): GraphNode[] {
    return this.db
      .prepare<[string], Record<string, unknown>>('SELECT * FROM nodes WHERE file_path = ?')
      .all(filePath)
      .map(r => this.deser(r));
  }

  getIncoming(nodeId: string): GraphEdge[] {
    return this.db.prepare<[string], GraphEdge>('SELECT * FROM edges WHERE target_id = ?').all(nodeId);
  }

  getOutgoing(nodeId: string): GraphEdge[] {
    return this.db.prepare<[string], GraphEdge>('SELECT * FROM edges WHERE source_id = ?').all(nodeId);
  }

  getNeighbourhood(startId: string, maxDepth = 2): string[] {
    const visited = new Set<string>([startId]);
    let frontier = [startId];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const ph = frontier.map(() => '?').join(',');
      const out = this.db.prepare<string[], { target_id: string }>(`SELECT target_id FROM edges WHERE source_id IN (${ph})`).all(...frontier).map(r => r.target_id);
      const inc = this.db.prepare<string[], { source_id: string }>(`SELECT source_id FROM edges WHERE target_id IN (${ph})`).all(...frontier).map(r => r.source_id);
      frontier = [...out, ...inc].filter(id => !visited.has(id));
      frontier.forEach(id => visited.add(id));
    }
    visited.delete(startId);
    return [...visited];
  }

  getDependencyChain(startId: string): string[] {
    const visited = new Set<string>();
    const stack = [startId];
    while (stack.length && visited.size < 50) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      this.db.prepare<[string], { target_id: string }>('SELECT target_id FROM edges WHERE source_id = ?').all(id).forEach(r => stack.push(r.target_id));
    }
    visited.delete(startId);
    return [...visited];
  }

  getAgentMemory(agentId: string, key: string): string | null {
    return this.db.prepare<[string, string], { value: string }>('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?').get(agentId, key)?.value ?? null;
  }

  setAgentMemory(agentId: string, key: string, value: string, nodeId: string | null = null): void {
    this.db.prepare('INSERT OR REPLACE INTO agent_memory (id, agent_id, node_id, key, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`${agentId}:${key}`, agentId, nodeId, key, value, Date.now());
  }

  getStats() {
    const nc = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    const ec = (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    const li = this.db.prepare<[string], { value: string }>('SELECT value FROM index_metadata WHERE key = ?').get('last_indexed')?.value;
    const ld = this.db.prepare<[string], { value: string }>('SELECT value FROM index_metadata WHERE key = ?').get('last_index_duration_ms')?.value;
    return { node_count: nc, edge_count: ec, last_indexed: li ? Number(li) : null, last_index_duration_ms: ld ? Number(ld) : null, schema_version: '1' };
  }

  private deser(row: Record<string, unknown>): GraphNode {
    return { ...(row as unknown as GraphNode), metadata: JSON.parse((row.metadata as string) ?? '{}') };
  }
}
