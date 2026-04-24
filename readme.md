# DeepGrep

A VS Code extension that gives Claude Code deep structural understanding of your codebase — at low token cost.

It parses your code into an AST-derived dependency graph (SQLite), exposes that graph to Claude Code via a local MCP server, and visualizes it in a Cytoscape.js webview.

---

## How it works

1. **Indexing** — Tree-sitter parses your workspace into nodes (functions, classes, imports) and edges (calls, imports, extends). Stored locally in `.deepgrep/graph.db`.
2. **MCP server** — A stdio server exposes graph query tools to Claude Code. Claude calls these instead of reading whole files.
3. **Webview** — A Cytoscape.js panel shows the graph. Nodes light up when Claude queries them so you can see its "cognitive boundary."
4. **Hooks** — A `PreToolUse` hook blocks dangerous edits (e.g. schema changes without a migration). A `PostToolUse` hook re-indexes any file Claude just edited.

---

## Project layout

```
packages/
  extension/     VS Code extension host (TypeScript + esbuild)
  webview-ui/    Cytoscape.js + React panel (Vite)
  mcp-server/    Standalone MCP stdio server
scripts/
  pre-tool-use.mjs   Blocks dangerous edits
  post-tool-use.mjs  Queues re-index after edits
.claude/
  settings.json  Hook wiring + permissions
  agents/        Sub-agent domain definitions
.deepgrep/
  graph.db       SQLite graph (gitignored)
```

Key files:
- [extension.ts](packages/extension/src/extension.ts) — activation, wires everything together
- [TreeSitterIndexer.ts](packages/extension/src/indexer/TreeSitterIndexer.ts) — AST → SQLite
- [GraphDatabase.ts](packages/extension/src/db/GraphDatabase.ts) — all SQLite queries
- [index.ts](packages/mcp-server/src/index.ts) — MCP server entry

---

## Getting started

```bash
pnpm install
pnpm build
```

Then open `packages/extension` in VS Code and press **F5** to launch the Extension Development Host.

Claude Code auto-discovers the MCP server via `.mcp.json`. Open the Command Palette → **DeepGrep: Open Graph** to see the visualization.

---

## MCP tools

These are the tools Claude Code can call. Tool names follow the `mcp__{server}__{tool}` format.

| Tool | What it does |
|------|-------------|
| `mcp__deepgrep__get_dependency_chain` | Full transitive dep chain for a symbol |
| `mcp__deepgrep__find_related_nodes` | Nodes within N hops of a file/symbol |
| `mcp__deepgrep__get_context_for_symbol` | Code snippet + callers + callees |
| `mcp__deepgrep__search_graph` | Fuzzy name search across all nodes |
| `mcp__deepgrep__get_agent_memory` | Read AST-bound memory for an agent |
| `mcp__deepgrep__set_agent_memory` | Write AST-bound memory for an agent |
| `mcp__deepgrep__get_stats` | Index freshness, node/edge counts, token savings |

### Adding a new tool

1. Create `packages/mcp-server/src/handlers/<name>.ts`
2. Register it in [index.ts](packages/mcp-server/src/index.ts) via `server.tool(...)`
3. Add it to the table above

---

## SQLite schema

```sql
nodes(id, type, name, file_path, start_line, end_line, language, code_snippet, metadata JSON)
edges(source_id, target_id, type)   -- calls | imports | extends | uses | exports | re-exports
agent_memory(id, agent_id, node_id, key, value, created_at)
index_metadata(key, value)
```

All SQLite access goes through [GraphDatabase.ts](packages/extension/src/db/GraphDatabase.ts) — no inline SQL anywhere else.

---

## Sub-agents

Each agent in `.claude/agents/` has a `domain_filter` (file globs it owns). The MCP server uses the `agent_id` arg on incoming tool calls to filter returned nodes to that domain and route memory reads/writes to `.claude/agent-memory/<agent_id>/`.

---

## Build reference

```bash
pnpm build              # build everything
pnpm dev                # watch mode
pnpm test               # run tests
pnpm package            # produce .vsix

# extension only
cd packages/extension
pnpm compile            # esbuild
pnpm rebuild-native     # rebuild better-sqlite3 for Electron
```
