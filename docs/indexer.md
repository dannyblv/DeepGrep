# Rust Indexer (`packages/indexer`)

## Why Rust

| | WASM (old) | Rust native (new) |
|---|---|---|
| Parse speed | ~1 k files/min | ~5–10 k files/min |
| File size cap | 500 KB (WASM heap) | 1 MB (tunable) |
| Crash isolation | One bad file kills session | Per-file error, others continue |
| Parallelism | Single-threaded | All CPU cores (rayon) |
| Startup | ~300 ms (WASM init) | ~5 ms |

## CLI

```bash
# Full workspace index
deepgrep-indexer index --workspace /path/to/project --db .deepgrep/graph.db

# Single-file incremental re-index
deepgrep-indexer reindex /abs/path/to/file.ts --workspace /path/to/project --db .deepgrep/graph.db
```

Both commands write a JSON summary to stdout:
```json
{"nodes": 4821, "edges": 9103, "files": 312, "duration_ms": 420}
```

Progress lines are written to stderr (picked up by the extension status bar).

## Module layout

```
src/
  main.rs          CLI (clap): index | reindex subcommands
  protocol.rs      Shared types: GraphNode, GraphEdge, ReExport, IndexResult
  db/
    mod.rs         Database handle — opens SQLite, runs migrations
    schema.rs      SCHEMA_SQL, FTS_SQL, MIGRATIONS_V3 constants
    writer.rs      upsert_nodes, upsert_edges, rebuild_fts, mark_stale_memories
  indexer/
    mod.rs         Grammars struct, parse_file, index_workspace (rayon entry point)
    walker.rs      File discovery — excludes node_modules/dist/target/…
    extractor.rs   Iterative AST walk → Vec<GraphNode> + Vec<GraphEdge>
    resolver.rs    Phantom edge resolution (cross-file call edges)
```

## Parallelism

`index_workspace` uses `rayon::par_iter` over the file list. Each rayon worker thread:
1. Creates its own `tree_sitter::Parser` (not `Send`, so thread-local)
2. Clones the `Language` handle (cheap — pointer to static C grammar data)
3. Parses the file and returns an `IndexResult`

Results are merged on the main thread before the single-transaction DB write.

## Phantom edge resolution

When a function call is parsed, the callee's line number is unknown (it may be in a different file). The extractor generates a **phantom ID**: `path:function:name:0`.

After all files are parsed, `resolver::resolve_phantoms` builds a symbol lookup table from all real nodes and walks the edge list replacing phantoms with real IDs. Strategies tried in order:
1. Exact file path match
2. Strip extension (`src/foo.tsx` → `src/foo`)
3. `@/` alias swap (`src/foo` ↔ `foo`)
4. Barrel re-export map (`src/index:ExportedName` → real source file)

## Stale memory detection

`node_hash` is a truncated SHA-256 of the node's `code_snippet`. On single-file re-index (`cmd_reindex`):
1. Fetch old `(id, node_hash)` pairs for the file before deleting
2. Compare with newly parsed nodes
3. Call `writer::mark_stale_memories` for changed node IDs — sets `agent_memory.stale_at`

The MCP `get_context_for_symbol` tool surfaces stale memories with `[STALE — code changed]`.
