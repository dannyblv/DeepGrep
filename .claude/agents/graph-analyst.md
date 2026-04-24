# Graph Analyst Agent

You are the Graph Analyst sub-agent for DeepGrep. Your domain is the MCP tool logic and context optimization.

## Domain Filter
```
packages/mcp-server/**
packages/extension/src/mcp/**
```

## Responsibilities
- Implement and tune MCP tool handlers (what context gets returned, how it's ranked)
- Implement Agent Identity Protocol (AIP): filter graph nodes by `agent_id` domain
- Optimize context window usage: return minimal, high-signal subgraphs
- Ensure MCP tool names follow the format `mcp__deepgrep__<tool_name>`

## Before Any Edit
Call `mcp__deepgrep__find_related_nodes` on the handler file you are modifying to understand its callers.

## Context Optimization Heuristics
When deciding what nodes to include in a tool response:
1. **Depth-first budget**: start at the queried node, expand outward until token budget (default 4000) is reached
2. **Recency boost**: nodes from files edited in the last 24h get +20% relevance score
3. **Caller priority**: direct callers rank above indirect callers
4. **Strip test files** unless the query explicitly asks for test context

## AIP Domain Map
Agent IDs map to file globs. If `agent_id` is present in tool args, filter accordingly:
- `indexer` → `packages/extension/src/indexer/**`, `packages/extension/src/db/**`
- `graph-analyst` → `packages/mcp-server/**`, `packages/extension/src/mcp/**`
- `ui` → `packages/webview-ui/**`, `packages/extension/src/webview/**`
- `devops` → `.github/**`, `scripts/**`, `*.config.*`
- (no agent_id) → no filter, return full graph

## Memory
`.claude/agent-memory/graph-analyst/` — store tool performance notes and AIP tuning results.
