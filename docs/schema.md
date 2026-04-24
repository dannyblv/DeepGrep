# SQLite Schema (v3)

DB location: `.deepgrep/graph.db` (WAL mode, 32 MB page cache)

## Tables

### `nodes`
One row per AST symbol.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | `rel_path:type:name:line` |
| `type` | TEXT | `file \| function \| class \| variable \| import \| interface \| type` |
| `name` | TEXT | Symbol name |
| `file_path` | TEXT | Relative path from workspace root |
| `start_line` | INTEGER | 0-based start line |
| `end_line` | INTEGER | 0-based end line |
| `language` | TEXT | `typescript \| tsx \| javascript \| python \| go \| rust` |
| `code_snippet` | TEXT | First 500 bytes of the definition |
| `node_hash` | TEXT | Truncated SHA-256 of `code_snippet` — used for stale detection |
| `metadata` | TEXT | JSON blob: `{arrow?, wrapped?, method?, module?}` |

### `edges`
One row per relationship. PK is `(source_id, target_id, type)`.

| Column | Type | Description |
|---|---|---|
| `source_id` | TEXT FK→nodes | Origin node |
| `target_id` | TEXT FK→nodes | Destination node |
| `type` | TEXT | `calls \| imports \| extends \| uses \| exports \| re-exports` |

### `agent_memory`
Persistent key-value store for AI agents. Optionally bound to an AST node.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | `agent_id:key` |
| `agent_id` | TEXT | Agent identifier (e.g. `indexer`, `graph-analyst`) |
| `node_id` | TEXT FK→nodes | Bound AST node (nullable) |
| `key` | TEXT | Memory key |
| `value` | TEXT | Memory value |
| `created_at` | INTEGER | Unix ms timestamp |
| `stale_at` | INTEGER | Set when bound node's `node_hash` changes; NULL = fresh |

### `nodes_fts`
FTS5 virtual table for trigram search (SQLite 3.34+).

```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
    id UNINDEXED, name, type UNINDEXED, file_path UNINDEXED,
    tokenize = 'trigram'
);
```

### `index_metadata`
Single-row key-value store for index state.

| Key | Value |
|---|---|
| `schema_version` | `3` |
| `last_indexed` | Unix ms timestamp |
| `last_index_duration_ms` | Milliseconds for last full index |

## Indexes

```sql
idx_nodes_file   ON nodes(file_path)
idx_nodes_name   ON nodes(name)
idx_nodes_type   ON nodes(type)
idx_edges_source ON edges(source_id)
idx_edges_target ON edges(target_id)
idx_memory_agent ON agent_memory(agent_id, key)
```

## Migration history

| Version | Change |
|---|---|
| v1 | Initial schema |
| v2 | Added `nodes_fts` FTS5 virtual table |
| v3 | Added `nodes.node_hash`, `agent_memory.stale_at` |
