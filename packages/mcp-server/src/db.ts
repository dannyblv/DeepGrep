import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface ContentMatch {
  file_path: string;
  line: number;
  kind: string;
  content: string;
}

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

type Stmt = ReturnType<DatabaseSync['prepare']>;

/**
 * Read-optimised DB layer for the MCP server.
 *
 * Key improvements over the naïve version:
 *  - Missing edge indexes added (idx_edges_source / idx_edges_target).
 *  - All statements pre-compiled once and reused (no per-call prepare cost).
 *  - getNeighbourhood / getDependencyChain use recursive CTEs — one SQL call
 *    instead of N+1 round-trips per hop/depth.
 *  - FTS5 trigram index used for searchNodes when the extension has built it.
 *  - 8-second TTL in-process result cache for repeated tool calls in a session.
 *  - Performance PRAGMAs: 32 MB page cache, mmap, NORMAL fsync.
 */
export class GraphDatabase {
  private readonly db: DatabaseSync;
  private readonly _searchFts: Stmt | null;
  private readonly _searchContentFts: Stmt | null;

  // Pre-compiled statements — pay prepare cost once at startup, not per call
  private readonly _getNode:       Stmt;
  private readonly _searchLike:    Stmt;
  private readonly _nodesForFile:  Stmt;
  private readonly _incoming:      Stmt;
  private readonly _outgoing:      Stmt;
  private readonly _neighbourhood: Stmt;
  private readonly _depChain:      Stmt;
  private readonly _getMemory:     Stmt;
  private readonly _setMemory:     Stmt;
  private readonly _countNodes:    Stmt;
  private readonly _countEdges:    Stmt;
  private readonly _metaGet:       Stmt;

  // TTL result cache — avoids repeated identical queries within one AI turn
  private readonly _cache = new Map<string, { r: unknown; t: number }>();
  private readonly TTL = 8_000; // ms

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode  = WAL;
      PRAGMA foreign_keys  = ON;
      PRAGMA cache_size    = -32000;
      PRAGMA mmap_size     = 268435456;
      PRAGMA temp_store    = MEMORY;
      PRAGMA synchronous   = NORMAL;
    `);
    this._ensureTables();

    // ── Compile all statements once ──────────────────────────────────────────
    this._getNode = this.db.prepare('SELECT * FROM nodes WHERE id = ?');

    this._searchLike = this.db.prepare(`
      SELECT * FROM nodes
      WHERE  name LIKE ?
        AND  file_path NOT LIKE '.next/%'
      ORDER BY length(name)
      LIMIT ?`);

    this._nodesForFile = this.db.prepare(
      'SELECT * FROM nodes WHERE file_path = ?');

    this._incoming = this.db.prepare(
      'SELECT * FROM edges WHERE target_id = ?');

    this._outgoing = this.db.prepare(
      'SELECT * FROM edges WHERE source_id = ?');

    // Bidirectional BFS via recursive CTE — replaces the JS BFS loop.
    // Parameters: startId, maxDepth, maxDepth, startId
    this._neighbourhood = this.db.prepare(`
      WITH RECURSIVE walk(id, depth) AS (
        VALUES(?, 0)
        UNION
        SELECT e.target_id, w.depth + 1
          FROM edges e JOIN walk w ON e.source_id = w.id
         WHERE w.depth < ?
        UNION
        SELECT e.source_id, w.depth + 1
          FROM edges e JOIN walk w ON e.target_id = w.id
         WHERE w.depth < ?
      )
      SELECT DISTINCT id FROM walk WHERE id != ?
      LIMIT 500`);

    // Forward dependency chain via recursive CTE — replaces the JS DFS loop.
    // Parameters: startId, startId  (second excludes start from results)
    this._depChain = this.db.prepare(`
      WITH RECURSIVE deps(id, depth) AS (
        SELECT target_id, 1 FROM edges WHERE source_id = ?
        UNION
        SELECT e.target_id, d.depth + 1
          FROM edges e JOIN deps d ON e.source_id = d.id
         WHERE d.depth < 10
      )
      SELECT DISTINCT d.id
        FROM deps d
        JOIN nodes n ON n.id = d.id
       WHERE d.id != ?
         AND n.file_path NOT LIKE '.next/%'
      LIMIT 50`);

    this._getMemory = this.db.prepare(
      'SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?');

    this._setMemory = this.db.prepare(
      'INSERT OR REPLACE INTO agent_memory (id, agent_id, node_id, key, value, created_at) VALUES (?, ?, ?, ?, ?, ?)');

    this._countNodes = this.db.prepare('SELECT COUNT(*) as c FROM nodes');
    this._countEdges = this.db.prepare('SELECT COUNT(*) as c FROM edges');
    this._metaGet    = this.db.prepare('SELECT value FROM index_metadata WHERE key = ?');

    // FTS5 — only available after the extension has run a full re-index with v2 schema
    this._searchFts = this._tryPrepareFts();
    this._searchContentFts = this._tryPrepareContentFts();
  }

  private _tryPrepareContentFts(): Stmt | null {
    try {
      this.db.prepare('SELECT 1 FROM content_fts LIMIT 1').get();
      return this.db.prepare(
        'SELECT file_path, line, kind, content FROM content_fts WHERE content MATCH ? LIMIT ?',
      );
    } catch {
      return null;
    }
  }

  private _tryPrepareFts(): Stmt | null {
    try {
      // Verify the table exists before compiling the statement
      this.db.prepare('SELECT 1 FROM nodes_fts LIMIT 1').get();
      return this.db.prepare(`
        SELECT n.*
          FROM nodes_fts
          JOIN nodes n ON n.id = nodes_fts.id
         WHERE nodes_fts MATCH ?
           AND nodes_fts.file_path NOT LIKE '.next/%'
         ORDER BY length(n.name)
         LIMIT ?`);
    } catch {
      return null;
    }
  }

  private _ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        name         TEXT NOT NULL,
        file_path    TEXT NOT NULL,
        start_line   INTEGER NOT NULL DEFAULT 0,
        end_line     INTEGER NOT NULL DEFAULT 0,
        language     TEXT NOT NULL DEFAULT '',
        code_snippet TEXT NOT NULL DEFAULT '',
        metadata     TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS edges (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type      TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, type)
      );
      CREATE TABLE IF NOT EXISTS agent_memory (
        id         TEXT PRIMARY KEY,
        agent_id   TEXT NOT NULL,
        node_id    TEXT,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS index_metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_name   ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_file   ON nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id, key);
    `);
  }

  // ── Result cache ─────────────────────────────────────────────────────────────

  private _cached<T>(key: string, fn: () => T): T {
    const e = this._cache.get(key);
    if (e && Date.now() - e.t < this.TTL) return e.r as T;
    const r = fn();
    this._cache.set(key, { r, t: Date.now() });
    if (this._cache.size > 300) {
      const now = Date.now();
      for (const [k, v] of this._cache) {
        if (now - v.t > this.TTL) this._cache.delete(k);
      }
    }
    return r;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  getNode(id: string): GraphNode | null {
    const row = this._getNode.get(id) as Record<string, unknown> | undefined;
    return row ? this._deser(row) : null;
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    return this._cached(`s:${query}:${limit}`, () => {
      // FTS5 path — O(log n) trigram lookup
      if (this._searchFts) {
        try {
          const phraseQuery = '"' + query.replace(/"/g, '""') + '"';
          const rows = (this._searchFts.all(phraseQuery, limit) as Record<string, unknown>[])
            .map(r => this._deser(r));
          if (rows.length > 0) return rows;
        } catch { /* malformed query — fall through */ }
      }
      // LIKE fallback — O(n) but indexed on name column
      const q = query.includes('%') ? query : `%${query}%`;
      return (this._searchLike.all(q, limit) as Record<string, unknown>[]).map(r => this._deser(r));
    });
  }

  getNodesForFile(filePath: string): GraphNode[] {
    return (this._nodesForFile.all(filePath) as Record<string, unknown>[]).map(r => this._deser(r));
  }

  getIncoming(nodeId: string): GraphEdge[] {
    return this._incoming.all(nodeId) as unknown as GraphEdge[];
  }

  getOutgoing(nodeId: string): GraphEdge[] {
    return this._outgoing.all(nodeId) as unknown as GraphEdge[];
  }

  getNeighbourhood(startId: string, maxDepth = 2): string[] {
    return this._cached(`n:${startId}:${maxDepth}`, () =>
      (this._neighbourhood.all(startId, maxDepth, maxDepth, startId) as { id: string }[])
        .map(r => r.id),
    );
  }

  getDependencyChain(startId: string): string[] {
    return this._cached(`d:${startId}`, () =>
      (this._depChain.all(startId, startId) as { id: string }[]).map(r => r.id),
    );
  }

  getAgentMemory(agentId: string, key: string): string | null {
    return (this._getMemory.get(agentId, key) as { value: string } | undefined)?.value ?? null;
  }

  setAgentMemory(agentId: string, key: string, value: string, nodeId: string | null = null): void {
    this._setMemory.run(`${agentId}:${key}`, agentId, nodeId, key, value, Date.now());
  }

  searchContent(query: string, limit = 20): ContentMatch[] {
    if (!this._searchContentFts) return [];
    try {
      const phraseQuery = '"' + query.replace(/"/g, '""') + '"';
      return this._searchContentFts.all(phraseQuery, limit) as unknown as ContentMatch[];
    } catch {
      return [];
    }
  }

  getStats() {
    const nc = (this._countNodes.get() as { c: number }).c;
    const ec = (this._countEdges.get() as { c: number }).c;
    const li = (this._metaGet.get('last_indexed')         as { value: string } | undefined)?.value;
    const ld = (this._metaGet.get('last_index_duration_ms') as { value: string } | undefined)?.value;
    const sv = (this._metaGet.get('schema_version')       as { value: string } | undefined)?.value ?? '1';
    return {
      node_count:           nc,
      edge_count:           ec,
      last_indexed:         li ? Number(li) : null,
      last_index_duration_ms: ld ? Number(ld) : null,
      schema_version:       sv,
    };
  }

  private _deser(row: Record<string, unknown>): GraphNode {
    return {
      ...(row as unknown as GraphNode),
      metadata: JSON.parse((row.metadata as string) ?? '{}'),
    };
  }
}
