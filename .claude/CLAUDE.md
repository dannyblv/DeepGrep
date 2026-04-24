# DeepGrep — Mandatory Search Protocol

## MANDATORY: use DeepGrep MCP tools — do NOT grep or glob the codebase

For every task — bug fixes, features, refactors, debugging — use the
`mcp__deepgrep__*` tools **FIRST**. They return pre-indexed, graph-ranked
context that is more relevant and uses fewer tokens than manual searching.

The PreToolUse hook will **block** recursive `grep`/`find` calls when the
graph is indexed.

## Output indicator (required)

Before calling ANY `mcp__deepgrep__*` tool, output this exact line in your
response text (replace `<tool>` with the tool name):

```
⬡ DeepGrep — <tool>
```

Examples:
- `⬡ DeepGrep — search_graph`
- `⬡ DeepGrep — get_context_for_symbol`
- `⬡ DeepGrep — get_dependency_chain`

This makes graph queries visible in the chat — do not skip it.

## Which tool to use

| Goal | Tool |
|---|---|
| Find a function/class by name | `mcp__deepgrep__search_graph` |
| What calls this function? | `mcp__deepgrep__get_context_for_symbol` |
| What does this file depend on? | `mcp__deepgrep__get_dependency_chain` |
| What is near this file/symbol? | `mcp__deepgrep__find_related_nodes` |
| Check index health | `mcp__deepgrep__get_stats` |

## Fallback rule

Only use `grep`/`Bash` search if:
1. `mcp__deepgrep__get_stats` shows `node_count: 0` (DB not yet indexed), **or**
2. A graph query returns no results for the specific symbol

## Indexing

If the graph is empty, open the project in VS Code and run:
**Command Palette → "DeepGrep: Re-index Workspace"**
