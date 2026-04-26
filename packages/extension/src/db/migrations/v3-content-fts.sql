-- Migration: extension schema v2 → v3
-- Adds content_fts FTS5 virtual table for string literals and comments.
-- The Rust indexer (deepgrep-indexer) populates this table during workspace indexing.

CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  file_path UNINDEXED,
  line      UNINDEXED,
  kind      UNINDEXED,
  content,
  tokenize  = 'trigram'
);

UPDATE index_metadata SET value = '3' WHERE key = 'schema_version';
