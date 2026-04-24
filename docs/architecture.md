# DeepGrep Architecture

## Overview

DeepGrep indexes your codebase into an AST-derived dependency graph (SQLite) and exposes it to Claude Code via a local MCP server. The stack is a Rust/TypeScript hybrid:

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension (TypeScript)                         │
│  ├── Activates on startup                               │
│  ├── Spawns deepgrep-indexer (Rust) for full/incremental│
│  │   indexing — writes to .deepgrep/graph.db            │
│  ├── Reads graph.db for webview (Cytoscape.js)          │
│  └── Registers deepgrep-mcp (Rust) with VS Code LM API │
└─────────────────────────────────────────────────────────┘
         │ spawns (child_process)
         ▼
┌─────────────────────────────────────────────────────────┐
│  deepgrep-indexer (Rust)                                │
│  ├── Native tree-sitter (no WASM, no 500 KB cap)        │
│  ├── Parallel file parsing via rayon                    │
│  ├── Phantom edge resolution (cross-file calls)         │
│  ├── Stale memory detection (node_hash diffing)         │
│  └── Writes directly to SQLite (WAL mode)               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  deepgrep-mcp (Rust) — stdio JSON-RPC server            │
│  ├── Claude Code connects via .mcp.json                 │
│  ├── Read-only SQLite queries (FTS5 + graph traversal)  │
│  └── 7 MCP tools — sub-millisecond response times       │
└─────────────────────────────────────────────────────────┘
         │ reads (read-only)
         ▼
┌─────────────────────────────────────────────────────────┐
│  .deepgrep/graph.db (SQLite, WAL mode)                  │
│  ├── nodes — AST symbols (functions, classes, imports…) │
│  ├── edges — relationships (calls, imports, extends…)   │
│  ├── agent_memory — per-agent key-value, AST-bound      │
│  ├── nodes_fts — FTS5 trigram search index              │
│  └── index_metadata — timestamps, schema version        │
└─────────────────────────────────────────────────────────┘
```

## Package layout

```
packages/
  indexer/       Rust — AST parser + SQLite writer
  mcp/           Rust — MCP stdio server
  extension/     TypeScript — VS Code extension host
  webview-ui/    TypeScript/React — Cytoscape.js graph panel
  mcp-server/    TypeScript — legacy Node.js MCP server (fallback)
Cargo.toml       Rust workspace (indexer + mcp)
```

## Data flow: workspace index

```
pnpm build:rust          →  target/release/deepgrep-indexer
Extension activates      →  spawns deepgrep-indexer index --workspace . --db .deepgrep/graph.db
Rust binary              →  walks files (rayon parallel)
                         →  parses AST (native tree-sitter, per-thread parsers)
                         →  resolves cross-file phantom edges
                         →  writes nodes/edges/FTS in single transaction
                         →  prints JSON summary to stdout
Extension reads stdout   →  updates status bar + webview
```

## Data flow: incremental re-index (on save / Claude Code edit)

```
Claude Code edits file   →  PostToolUse hook appends to .deepgrep/reindex-queue.json
Extension watcher fires  →  debounce 300ms
                         →  spawns deepgrep-indexer reindex <file> …
Rust binary              →  diffs node_hash → marks stale agent memories
                         →  replaces file's nodes/edges atomically
Extension               →  refreshes webview
```

## MCP server startup

Claude Code reads `.mcp.json` (written by the extension on activate) and launches `deepgrep-mcp` as a child process. The binary opens the SQLite DB read-only and serves JSON-RPC requests over stdio. See [mcp-server.md](mcp-server.md).
