-- Migration: schema v1 → v2
-- Adds FTS5 trigram virtual table for fast substring name search (replaces O(n) LIKE scan).
-- GraphDatabase._tryInitFts() creates this table at runtime; this file documents the change.

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id        UNINDEXED,
  name,
  type      UNINDEXED,
  file_path UNINDEXED,
  tokenize  = 'trigram'
);

-- Populate from existing nodes (run once on upgrade; GraphDatabase.ensureSchemaVersion handles this)
INSERT OR IGNORE INTO nodes_fts(id, name, type, file_path)
SELECT id, name, type, file_path FROM nodes;

UPDATE index_metadata SET value = '2' WHERE key = 'schema_version';
