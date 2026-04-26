# DeepGrep — Development Protocol

DeepGrep is a VS Code extension that indexes a codebase into an AST-derived dependency graph (SQLite), exposes it to Claude Code via a local MCP server, and visualizes it in a Cytoscape.js webview.

## Search: DeepGrep for structure, search_text for literals, rg for everything else

DeepGrep indexes **defined names** (functions, classes, interfaces, import specifiers).
`search_text` indexes **string literals and comments**.
Use `rg` only when both return no results.

| Use DeepGrep for | Use search_text for | Use rg for |
|---|---|---|
| Find a defined symbol by name | String literals, error messages | Config keys, regexes |
| Callers / callees of a function | JSX prop values, TODOs | Multi-file text patterns |
| Import dependency chain | Comments | Anything not yet indexed |
| Nearby nodes in the graph | — | — |

**Never trust "No nodes found" alone** — confirm a `search_graph` miss with `search_text`, then `rg`, before concluding a symbol doesn't exist.

| Goal | Tool |
|---|---|
| Find symbol by name | `mcp__deepgrep__search_graph` |
| Find string literal or comment | `mcp__deepgrep__search_text` |
| Callers / callees | `mcp__deepgrep__get_context_for_symbol` |
| Import chain | `mcp__deepgrep__get_dependency_chain` |
| Nearby nodes | `mcp__deepgrep__find_related_nodes` |
| Index metrics | `mcp__deepgrep__get_stats` |
| Agent memory r/w | `mcp__deepgrep__{get,set}_agent_memory` |

Before each call, output this block in text (not a code block):

---
**⬡ DeepGrep** — `<tool>` — *<one-line description of what you're looking for>*

## Layout

```
packages/
  extension/       VS Code extension host (TypeScript, esbuild)
  webview-ui/      Cytoscape.js + React panel (Vite)
  mcp-server/      Standalone MCP stdio server
scripts/
  pre-tool-use.mjs   PreToolUse hook — blocks dangerous edits
  post-tool-use.mjs  PostToolUse hook — queues re-index
.deepgrep/
  graph.db, reindex-queue.json (gitignored)
```

Key files:
- [packages/extension/src/extension.ts](packages/extension/src/extension.ts) — activation entry
- [packages/extension/src/indexer/TreeSitterIndexer.ts](packages/extension/src/indexer/TreeSitterIndexer.ts) — AST → SQLite
- [packages/extension/src/db/GraphDatabase.ts](packages/extension/src/db/GraphDatabase.ts) — all SQLite queries
- [packages/extension/src/mcp/McpServerProvider.ts](packages/extension/src/mcp/McpServerProvider.ts) — VS Code MCP registration
- [packages/mcp-server/src/index.ts](packages/mcp-server/src/index.ts) — stdio MCP server
- [packages/webview-ui/src/App.tsx](packages/webview-ui/src/App.tsx) — Cytoscape panel root

## SQLite schema

```sql
nodes(id PK, type, name, file_path, start_line, end_line, language, code_snippet, metadata JSON)
edges(source_id FK, target_id FK, type, PRIMARY KEY(source,target,type))
agent_memory(id PK, agent_id, node_id FK, key, value, created_at)
index_metadata(key PK, value)
```
Edge types: `calls | imports | extends | uses | exports | re-exports`

## Architecture rules

- All SQLite access goes through `GraphDatabase.ts` — no inline SQL elsewhere
- MCP server only **reads** the DB; writes go through the extension host
- Webview ↔ extension messages use the discriminated union in [packages/extension/src/webview/messages.ts](packages/extension/src/webview/messages.ts)
- Tree-sitter grammars load from `packages/extension/grammars/*.wasm`
- `signalActivity('<tool>')` must be called at the top of every MCP tool handler so the webview animates

## Schema changes

Any `CREATE TABLE` / `ALTER TABLE` / `DROP` in `GraphDatabase.ts` requires:
1. A migration file in `packages/extension/src/db/migrations/`
2. Bumping `schema_version` in `index_metadata`

The PreToolUse hook blocks direct edits to `.deepgrep/graph.db` and destructive SQL without a migration.

## Hooks

- **PreToolUse**: receives `{tool_name, tool_input}` on stdin. Exits `2` (block) on Edit/Write to `GraphDatabase.ts` without a matching migration, or on raw `DROP`/`DELETE` SQL.
- **PostToolUse**: appends edited file path to `.deepgrep/reindex-queue.json`; the extension's watcher re-indexes within 500ms.

## Agent Identity Protocol

MCP tool calls may include `agent_id`. The server uses it to filter nodes to the agent's `domain_filter` (set in `.claude/agents/<name>.md`), route memory to `.claude/agent-memory/<agent_id>/`, and log served nodes for webview highlighting.

## Build

```bash
pnpm install && pnpm build   # extension + webview + mcp-server
pnpm dev                     # watch mode
pnpm test                    # all tests
pnpm package                 # produce .vsix
cd packages/extension && pnpm rebuild-native  # after Node/Electron bump
```

Dev loop: open `packages/extension` in VS Code → F5 launches the Extension Development Host. Claude Code in the terminal auto-discovers the MCP server via `.mcp.json`.

## Adding an MCP tool

1. Handler in `packages/mcp-server/src/handlers/<name>.ts`
2. Register in `packages/mcp-server/src/index.ts` via `server.tool(...)`
3. Call `signalActivity('<name>')` at the top of the handler
4. Add to the MCP tool table above
5. Add to the flavor table in `HookManager.ts` `CLAUDE_MD_SECTION` so injected projects get the indicator

## HookManager injection

`HookManager.ts` writes a `CLAUDE_MD_SECTION` into any workspace that opens the extension. Keep that section concise — it's the end-user version, not this dev guide. The styled `---` / **⬡ DeepGrep** indicator format lives there.
