pub const SCHEMA_VERSION: &str = "4";

pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS nodes (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    name         TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    start_line   INTEGER NOT NULL DEFAULT 0,
    end_line     INTEGER NOT NULL DEFAULT 0,
    language     TEXT NOT NULL DEFAULT '',
    code_snippet TEXT NOT NULL DEFAULT '',
    node_hash    TEXT NOT NULL DEFAULT '',
    metadata     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type      TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, type),
    FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_memory (
    id         TEXT PRIMARY KEY,
    agent_id   TEXT NOT NULL,
    node_id    TEXT,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    stale_at   INTEGER,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS index_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_file   ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_name   ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_type   ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id, key);
"#;

pub const FTS_SQL: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id        UNINDEXED,
    name,
    type      UNINDEXED,
    file_path UNINDEXED,
    tokenize  = 'trigram'
);
"#;

pub const CONTENT_FTS_SQL: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    file_path UNINDEXED,
    line      UNINDEXED,
    kind      UNINDEXED,
    content,
    tokenize  = 'trigram'
);
"#;

/// Migrations from v0/v1/v2 → v3 (adds node_hash + stale_at).
pub const MIGRATIONS_V3: &[&str] = &[
    "ALTER TABLE nodes ADD COLUMN node_hash TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE agent_memory ADD COLUMN stale_at INTEGER",
];
// v3 → v4: content_fts is a new virtual table created by CONTENT_FTS_SQL; no ALTER needed.
