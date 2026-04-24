# Rust MCP Server (`packages/mcp`)

## Overview

`deepgrep-mcp` is a JSON-RPC 2.0 stdio server. Claude Code launches it via `.mcp.json` and sends tool-call requests over stdin; the server replies on stdout.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEEPGREP_DB_PATH` | `.deepgrep/graph.db` | SQLite DB to read from |
| `DEEPGREP_WORKSPACE` | `.` | Workspace root (for mcp-activity.json) |
| `DEEPGREP_TOKEN_BUDGET` | `4000` | Max tokens per response (controls snippet truncation) |

## Protocol

Newline-delimited JSON-RPC 2.0 over stdio. One JSON object per line, no content-length framing.

```
Client → Server: {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
Server → Client: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05",...}}
Client → Server: {"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
Client → Server: {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
Server → Client: {"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}
Client → Server: {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_graph","arguments":{...}}}
Server → Client: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"..."}]}}
```

## Module layout

```
src/
  main.rs          Stdio read loop + request dispatch
  protocol.rs      RpcRequest, RpcResponse, RpcError, tool_list()
  db/
    mod.rs         Db — read-only SQLite connection
    queries.rs     All SQL: search_nodes, get_node, edges, neighbourhood, dep_chain, memory, stats
  tools/
    mod.rs         dispatch(tool_name, args) → String
    search.rs      search_graph
    context.rs     get_context_for_symbol (+ stale memory surfacing)
    deps.rs        get_dependency_chain
    related.rs     find_related_nodes
    memory.rs      get_agent_memory / set_agent_memory
    stats.rs       get_stats
```

## Tools reference

### `search_graph`
Fuzzy name search via FTS5 trigram index (falls back to `LIKE` on older SQLite).

### `get_context_for_symbol`
Returns source snippet + callers + callees. If any agent memories bound to the node are stale, they are listed with `[STALE — code changed]` before the source.

### `get_dependency_chain`
Forward DFS from the symbol following all outgoing edges. Capped at `token_budget / 20` (min 10, max 50) nodes.

### `find_related_nodes`
Bidirectional BFS up to `hops` (1–5) from the symbol or file. Returns names, types, and file paths.

### `get_agent_memory` / `set_agent_memory`
Persistent key-value store per agent. Memories can be bound to a specific AST node ID so they go stale automatically when the node's code changes.

### `get_stats`
Node count, edge count, last index time, schema version.

## Activity signalling

Every `tools/call` writes `.deepgrep/mcp-activity.json`:
```json
{"tool": "search_graph", "ts": 1714000000000}
```
The VS Code extension watches this file and animates the `⬡` indicator in the webview.
