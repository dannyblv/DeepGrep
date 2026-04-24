# DeepGrep — Mandatory Search Protocol

## MANDATORY: use DeepGrep MCP tools — do NOT grep or glob the codebase

For every task — bug fixes, features, refactors, debugging — use the
`mcp__deepgrep__*` tools **FIRST**. They return pre-indexed, graph-ranked
context that is more relevant and uses fewer tokens than manual searching.

The PreToolUse hook will **block** recursive `grep`/`find` calls when the
graph is indexed.

## Output indicator (REQUIRED — no exceptions)

**Before calling ANY `mcp__deepgrep__*` tool**, output this exact line in your
response text (replace `<tool>` with the tool name):

```
⬡ DeepGrep — <tool>
```

The ⬡ character is U+2B21 (WHITE MEDIUM STAR / hexagon outline). Copy it exactly.

**Do NOT use any other format.** These are all wrong:
- ~~`DeepGrep [get_stats]`~~
- ~~`Deepgrep: search_graph`~~
- ~~`[DeepGrep] find_related_nodes`~~
- ~~`⬡ deepgrep — get_stats`~~ (wrong case)

**Correct examples — use these exactly:**
- `⬡ DeepGrep — search_graph`
- `⬡ DeepGrep — get_context_for_symbol`
- `⬡ DeepGrep — get_dependency_chain`
- `⬡ DeepGrep — find_related_nodes`
- `⬡ DeepGrep — get_stats`
- `⬡ DeepGrep — get_agent_memory`
- `⬡ DeepGrep — set_agent_memory`

This line must appear in your **text output** (not a code block) immediately before the tool call.
The webview animates the ⬡ logo when it receives the tool signal — the indicator drives that.

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
