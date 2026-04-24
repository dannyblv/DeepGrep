# DeepGrep — Claude Code Environment

## Project Purpose
DeepGrep is a VS Code extension that indexes your codebase into an AST-derived dependency graph (SQLite), exposes that graph to Claude Code via a local MCP server, and visualizes it in a Cytoscape.js webview. The goal: give Claude Code deep structural context at low token cost.

## Architecture

```
packages/
  extension/       VS Code extension host (TypeScript, esbuild)
  webview-ui/      Cytoscape.js + React panel (Vite)
  mcp-server/      Standalone MCP stdio server (@modelcontextprotocol/sdk)
scripts/
  pre-tool-use.mjs   Claude Code PreToolUse hook — blocks dangerous edits
  post-tool-use.mjs  Claude Code PostToolUse hook — queues re-index
.claude/
  settings.json      Hook wiring + permissions
  agents/            Sub-agent CLAUDE.md files
.deepgrep/
  graph.db           SQLite graph (gitignored)
  reindex-queue.json File paths queued for re-index by PostToolUse hook
```

## Key Files
- `packages/extension/src/extension.ts` — activation entry, wires everything together
- `packages/extension/src/indexer/TreeSitterIndexer.ts` — AST → SQLite nodes/edges
- `packages/extension/src/db/GraphDatabase.ts` — all SQLite queries
- `packages/extension/src/mcp/McpServerProvider.ts` — VS Code MCP registration
- `packages/mcp-server/src/index.ts` — stdio MCP server process
- `packages/webview-ui/src/App.tsx` — Cytoscape panel root

## SQLite Schema
```sql
nodes(id PK, type, name, file_path, start_line, end_line, language, code_snippet, metadata JSON)
edges(source_id FK, target_id FK, type, PRIMARY KEY(source,target,type))
agent_memory(id PK, agent_id, node_id FK, key, value, created_at)
index_metadata(key PK, value)
```
Edge types: `calls | imports | extends | uses | exports | re-exports`

## MCP Tool Names (mcp__{server}__{tool})
| Tool | Purpose |
|------|---------|
| `mcp__deepgrep__get_dependency_chain` | Full transitive dep chain for a symbol |
| `mcp__deepgrep__find_related_nodes` | Nodes within N hops of a file/symbol |
| `mcp__deepgrep__get_context_for_symbol` | Code snippet + callers + callees |
| `mcp__deepgrep__search_graph` | Fuzzy name search across all nodes |
| `mcp__deepgrep__get_agent_memory` | Read AST-bound memory for an agent |
| `mcp__deepgrep__set_agent_memory` | Write AST-bound memory for an agent |
| `mcp__deepgrep__get_stats` | Index freshness, node/edge counts, token savings |

## Agent Identity Protocol (AIP)
All MCP tool calls may include `agent_id` in their arguments. The server uses this to:
- Filter returned nodes to the agent's domain (set in `.claude/agents/<name>.md`)
- Route memory reads/writes to `.claude/agent-memory/<agent_id>/`
- Log which nodes were served (drives webview highlighting)

## Build Commands
```bash
pnpm install                  # install all workspaces
pnpm build                    # build extension + webview + mcp-server
pnpm dev                      # watch mode for all packages
pnpm test                     # run all tests
pnpm package                  # build .vsix for marketplace

# In packages/extension/:
pnpm compile                  # esbuild extension only
pnpm rebuild-native           # rebuild better-sqlite3 for VS Code's Electron
```

## Development Workflow
1. `pnpm install && pnpm build`
2. Open `packages/extension` in VS Code, press F5 to launch Extension Development Host
3. The extension auto-starts the MCP server as a child process on port stdio
4. Open Command Palette → "DeepGrep: Open Graph" to see the visualization
5. Claude Code in the terminal auto-discovers the MCP server via `.mcp.json`

## Adding a New MCP Tool
1. Add handler in `packages/mcp-server/src/handlers/<name>.ts`
2. Register it in `packages/mcp-server/src/index.ts` via `server.tool(...)`
3. Add the tool name to the table above
4. The VS Code extension re-registers automatically (the provider re-queries on demand)

## Hooks Behaviour
- **PreToolUse**: receives `{tool_name, tool_input}` on stdin. Exits `2` (block) if an Edit/Write targets `packages/extension/src/db/GraphDatabase.ts` without a matching migration file, or if it detects a DROP/DELETE in raw SQL strings.
- **PostToolUse**: appends edited file path to `.deepgrep/reindex-queue.json`. The extension's `GraphDatabase` watcher picks this up and re-indexes within 500ms.

## Efficiency Metrics
The `get_stats` MCP tool and the "Stats" tab in the webview report:
- Nodes / Edges indexed
- Last index timestamp + duration
- Token savings: estimated tokens served vs. full-file context
- Cache hit rate for repeated symbol lookups
- P50/P95 query latency (ms)

## Sub-Agents
See `.claude/agents/` for domain-specific agent definitions. Each agent has:
- A `domain_filter` (file glob list it cares about)
- Pre-loaded memory path `.claude/agent-memory/<name>/`
- Instruction to call `mcp__deepgrep__get_context_for_symbol` before any edit

## Conventions
- All SQLite access goes through `GraphDatabase.ts` — no inline SQL elsewhere
- Tree-sitter grammars load from `packages/extension/grammars/*.wasm`
- Webview messages use the discriminated union type in `packages/extension/src/webview/messages.ts`
- Never write to `.deepgrep/graph.db` from the MCP server process — only reads; writes go through the extension host
