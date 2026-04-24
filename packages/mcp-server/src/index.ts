#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { GraphDatabase } from './db.js';

const DB_PATH = process.env.DEEPGREP_DB_PATH ?? resolve(process.cwd(), '.deepgrep', 'graph.db');
const WORKSPACE = process.env.DEEPGREP_WORKSPACE ?? process.cwd();
const TOKEN_BUDGET = Number(process.env.DEEPGREP_TOKEN_BUDGET ?? 4000);

if (!existsSync(DB_PATH)) {
  process.stderr.write(`DeepGrep MCP: graph.db not found at ${DB_PATH}. Run "DeepGrep: Re-index Workspace" in VS Code first.\n`);
}

const db = new GraphDatabase(DB_PATH);
const server = new McpServer({ name: 'deepgrep', version: '0.1.0' });

// ── Tool: get_dependency_chain ───────────────────────────────────────────────
server.tool(
  'get_dependency_chain',
  'Get the full transitive dependency chain for a symbol. Returns all nodes it depends on.',
  {
    symbol: z.string().describe('Function or class name to start from'),
    file_path: z.string().optional().describe('File path to narrow the search'),
    agent_id: z.string().optional().describe('Calling agent ID for domain filtering'),
  },
  async ({ symbol, file_path, agent_id }) => {
    const candidates = db.searchNodes(symbol, 5);
    const filtered = file_path
      ? candidates.filter(n => n.file_path.includes(file_path))
      : candidates;
    if (filtered.length === 0) {
      return { content: [{ type: 'text', text: `No nodes found for symbol "${symbol}"` }] };
    }
    const start = filtered[0];
    const depIds = db.getDependencyChain(start.id);
    const deps = depIds
      .map(id => db.getNode(id))
      .filter(Boolean)
      .filter(n => agentFilter(n!, agent_id));

    const budget = estimateBudget(deps.length);
    const result = deps.slice(0, budget).map(n => formatNode(n!));
    trackQuery(agent_id, start.id, result.map(r => r.id));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            start: formatNode(start),
            dependencies: result,
            total: deps.length,
            shown: result.length,
            token_estimate: result.length * 150,
          }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: find_related_nodes ─────────────────────────────────────────────────
server.tool(
  'find_related_nodes',
  'Find all nodes within N hops of a file or symbol in the dependency graph.',
  {
    symbol: z.string().optional(),
    file_path: z.string().optional(),
    hops: z.number().min(1).max(5).default(2),
    agent_id: z.string().optional(),
  },
  async ({ symbol, file_path, hops, agent_id }) => {
    let startId: string | null = null;
    if (symbol) {
      const nodes = db.searchNodes(symbol, 3);
      startId = nodes[0]?.id ?? null;
    } else if (file_path) {
      const nodes = db.getNodesForFile(file_path);
      startId = nodes.find(n => n.type === 'file')?.id ?? nodes[0]?.id ?? null;
    }
    if (!startId) {
      return { content: [{ type: 'text', text: 'No matching node found.' }] };
    }
    const neighbourIds = db.getNeighbourhood(startId, hops);
    const neighbours = neighbourIds
      .map(id => db.getNode(id))
      .filter(Boolean)
      .filter(n => agentFilter(n!, agent_id));

    const budget = estimateBudget(neighbours.length);
    const result = neighbours.slice(0, budget).map(n => formatNode(n!));
    trackQuery(agent_id, startId, result.map(r => r.id));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ start_id: startId, related: result, total: neighbours.length }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: get_context_for_symbol ─────────────────────────────────────────────
server.tool(
  'get_context_for_symbol',
  'Get code snippet, direct callers, and direct callees for a symbol. Core tool for understanding a function before editing it.',
  {
    symbol: z.string(),
    file_path: z.string().optional(),
    agent_id: z.string().optional(),
  },
  async ({ symbol, file_path, agent_id }) => {
    const candidates = db.searchNodes(symbol, 5);
    const node = file_path
      ? candidates.find(n => n.file_path.includes(file_path)) ?? candidates[0]
      : candidates[0];
    if (!node) {
      return { content: [{ type: 'text', text: `Symbol "${symbol}" not found in graph.` }] };
    }
    const callerEdges = db.getIncoming(node.id);
    const calleeEdges = db.getOutgoing(node.id);
    const callers = callerEdges.map(e => db.getNode(e.source_id)).filter(Boolean).map(n => formatNode(n!));
    const callees = calleeEdges.map(e => db.getNode(e.target_id)).filter(Boolean).map(n => formatNode(n!));
    trackQuery(agent_id, node.id, [node.id, ...callers.map(c => c.id), ...callees.map(c => c.id)]);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            node: formatNode(node),
            snippet: node.code_snippet,
            callers,
            callees,
            edit_advice: `Before modifying ${node.name}, review the ${callers.length} callers listed above to understand impact.`,
          }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: search_graph ────────────────────────────────────────────────────────
server.tool(
  'search_graph',
  'Fuzzy search across all indexed nodes by name.',
  {
    query: z.string(),
    limit: z.number().min(1).max(50).default(10),
    agent_id: z.string().optional(),
  },
  async ({ query, limit, agent_id }) => {
    const nodes = db.searchNodes(query, limit).filter(n => agentFilter(n, agent_id));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(nodes.map(n => formatNode(n)), null, 2),
        },
      ],
    };
  },
);

// ── Tool: get_agent_memory ────────────────────────────────────────────────────
server.tool(
  'get_agent_memory',
  'Read a persistent memory value bound to this agent.',
  { agent_id: z.string(), key: z.string() },
  async ({ agent_id, key }) => {
    const value = db.getAgentMemory(agent_id, key);
    return {
      content: [{ type: 'text', text: value ?? `(no memory for key "${key}")` }],
    };
  },
);

// ── Tool: set_agent_memory ────────────────────────────────────────────────────
server.tool(
  'set_agent_memory',
  'Write a persistent memory value, optionally bound to an AST node.',
  {
    agent_id: z.string(),
    key: z.string(),
    value: z.string(),
    node_id: z.string().optional(),
  },
  async ({ agent_id, key, value, node_id }) => {
    db.setAgentMemory(agent_id, key, value, node_id ?? null);
    return { content: [{ type: 'text', text: `Memory saved: ${key}` }] };
  },
);

// ── Tool: get_stats ───────────────────────────────────────────────────────────
server.tool(
  'get_stats',
  'Get DeepGrep index stats: node/edge counts, last index time, efficiency metrics.',
  {},
  async () => {
    const stats = db.getStats();
    const queryStats = db.getAgentMemory('__system', 'query_stats');
    const parsed = queryStats ? JSON.parse(queryStats) : { total: 0, token_savings: 0 };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...stats,
            query_count: parsed.total,
            estimated_token_savings: parsed.token_savings,
            last_indexed_relative: stats.last_indexed
              ? `${Math.round((Date.now() - stats.last_indexed) / 1000)}s ago`
              : 'never',
          }, null, 2),
        },
      ],
    };
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGENT_DOMAIN_MAP: Record<string, string[]> = {
  indexer: ['packages/extension/src/indexer', 'packages/extension/src/db'],
  'graph-analyst': ['packages/mcp-server', 'packages/extension/src/mcp'],
  ui: ['packages/webview-ui', 'packages/extension/src/webview'],
};

function agentFilter(node: { file_path: string }, agentId?: string): boolean {
  if (!agentId || !AGENT_DOMAIN_MAP[agentId]) return true;
  return AGENT_DOMAIN_MAP[agentId].some(prefix => node.file_path.startsWith(prefix));
}

function estimateBudget(total: number): number {
  // Rough: each node costs ~150 tokens. Stay within TOKEN_BUDGET.
  return Math.min(total, Math.floor(TOKEN_BUDGET / 150));
}

function formatNode(n: {
  id: string;
  name: string;
  type: string;
  file_path: string;
  start_line: number;
  end_line: number;
}) {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    file: n.file_path,
    lines: `${n.start_line}-${n.end_line}`,
  };
}

function trackQuery(agentId: string | undefined, startId: string, servedIds: string[]): void {
  const raw = db.getAgentMemory('__system', 'query_stats');
  const stats = raw ? JSON.parse(raw) : { total: 0, token_savings: 0 };
  stats.total++;
  stats.token_savings += servedIds.length * 200;
  db.setAgentMemory('__system', 'query_stats', JSON.stringify(stats), startId);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
