# DeepGrep — Development Protocol

## Search: use MCP tools first

When the graph is indexed, use `mcp__deepgrep__*` instead of grep/find.

| Goal | Tool |
|---|---|
| Find symbol by name | `mcp__deepgrep__search_graph` |
| Callers / callees | `mcp__deepgrep__get_context_for_symbol` |
| Import chain | `mcp__deepgrep__get_dependency_chain` |
| Nearby nodes | `mcp__deepgrep__find_related_nodes` |

Before each call output this block in text (not a code block):

---
**⬡ DeepGrep** — `<tool>` — *<one-line description of what you're looking for>*

Fallback to grep/bash only if `get_stats` shows `node_count: 0` or a query returns nothing.

## Architecture rules

- All SQLite access goes through `GraphDatabase.ts` — no inline SQL anywhere else
- MCP server only **reads** the DB; writes go through the extension host
- Webview ↔ extension messages use the discriminated union in `packages/extension/src/webview/messages.ts`
- Tree-sitter grammars load from `packages/extension/grammars/*.wasm`
- `signalActivity('<tool>')` must be called at the top of every MCP tool handler so the webview animates

## Schema changes

Any `CREATE TABLE` / `ALTER TABLE` / `DROP` in `GraphDatabase.ts` requires:
1. A migration file in `packages/extension/src/db/migrations/`
2. Bumping `schema_version` in `index_metadata`

The PreToolUse hook blocks direct edits to `.deepgrep/graph.db` and destructive SQL without a migration.

## Build

```bash
pnpm install && pnpm build   # full build (extension + webview + mcp-server)
pnpm dev                     # watch mode for all packages
pnpm test                    # all tests
pnpm package                 # produce .vsix for marketplace
cd packages/extension && pnpm rebuild-native  # after Node/Electron version bump
```

## Adding an MCP tool

1. Handler in `packages/mcp-server/src/handlers/<name>.ts`
2. Register in `packages/mcp-server/src/index.ts` via `server.tool(...)`
3. Call `signalActivity('<name>')` at the top of the handler
4. Add to the MCP tool table in root `CLAUDE.md`
5. Add to the flavor table in `HookManager.ts` `CLAUDE_MD_SECTION` so injected projects get the indicator

## HookManager injection

`HookManager.ts` writes a `CLAUDE_MD_SECTION` into any workspace that opens the extension. Keep that section concise — it's the end-user version, not this dev guide. The styled `---` / **⬡ DeepGrep** indicator format lives there.
