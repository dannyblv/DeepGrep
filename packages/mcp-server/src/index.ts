#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { GraphDatabase } from './db.js';

const DB_PATH = process.env.DEEPGREP_DB_PATH ?? resolve(process.cwd(), '.deepgrep', 'graph.db');
const WORKSPACE = process.env.DEEPGREP_WORKSPACE ?? process.cwd();
const TOKEN_BUDGET = Number(process.env.DEEPGREP_TOKEN_BUDGET ?? 4000);
const ACTIVITY_PATH = DB_PATH.replace('graph.db', 'mcp-activity.json');

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
      signalActivity('get_dependency_chain', 0);
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
    signalActivity('get_dependency_chain', result.length);

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
    max_nodes: z.number().min(1).max(200).default(60),
    agent_id: z.string().optional(),
  },
  async ({ symbol, file_path, hops, max_nodes, agent_id }) => {
    let startId: string | null = null;
    if (symbol) {
      const nodes = db.searchNodes(symbol, 3);
      startId = nodes[0]?.id ?? null;
    } else if (file_path) {
      // Try direct file_path lookup first, then fall back to name search
      const byPath = db.getNodesForFile(file_path).find(n => n.type === 'file');
      if (byPath) {
        startId = byPath.id;
      } else {
        const byName = db.searchNodes(file_path, 10);
        startId = byName.find(n => n.type === 'file')?.id ?? byName[0]?.id ?? null;
      }
    }
    if (!startId) {
      signalActivity('find_related_nodes', 0);
      return { content: [{ type: 'text', text: 'No matching node found.' }] };
    }
    const neighbourIds = db.getNeighbourhood(startId, hops);
    const neighbours = neighbourIds
      .map(id => db.getNode(id))
      .filter(Boolean)
      .filter(n => agentFilter(n!, agent_id));

    const capped = Math.min(neighbours.length, max_nodes);
    const result = neighbours.slice(0, capped).map(n => formatNode(n!));
    signalActivity('find_related_nodes', result.length);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ start_id: startId, related: result, total: neighbours.length, shown: capped }, null, 2),
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
  async ({ symbol, file_path }) => {
    const candidates = db.searchNodes(symbol, 5);
    const node = file_path
      ? candidates.find(n => n.file_path.includes(file_path)) ?? candidates[0]
      : candidates[0];
    if (!node) {
      signalActivity('get_context_for_symbol', 0);
      return { content: [{ type: 'text', text: `Symbol "${symbol}" not found in graph.` }] };
    }
    const callerEdges = db.getIncoming(node.id);
    const calleeEdges = db.getOutgoing(node.id);
    const callers = callerEdges.map(e => db.getNode(e.source_id)).filter(Boolean).map(n => formatNode(n!));
    const callees = calleeEdges.map(e => db.getNode(e.target_id)).filter(Boolean).map(n => formatNode(n!));
    const served = [node.id, ...callers.map(c => c.id), ...callees.map(c => c.id)];
    signalActivity('get_context_for_symbol', served.length);

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
    let nodes = db.searchNodes(query, limit).filter(n => agentFilter(n, agent_id));
    if (nodes.length === 0) {
      nodes = rgFallbackNodes(query, limit);
    }
    signalActivity('search_graph', nodes.length);
    if (nodes.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No nodes found matching "${query}"\n\n**Coverage note**: the index tracks defined names — functions, classes, interfaces, and import specifiers. It does not cover string literals, comments, JSX prop values, or config keys. If you expected a match, use search_text or rg before concluding the symbol doesn't exist.`,
        }],
      };
    }
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

// ── Tool: search_text ────────────────────────────────────────────────────────
server.tool(
  'search_text',
  'Search string literals and comments across all indexed files. Use for finding error messages, config keys, JSX prop values, and TODO comments that are not indexed as symbols.',
  {
    query: z.string().describe('Text to search for in string literals and comments'),
    limit: z.number().min(1).max(50).default(20),
    kind: z.enum(['string', 'comment']).optional().describe('Filter to only strings or only comments'),
  },
  async ({ query, limit, kind }) => {
    const matches = db.searchContent(query, limit);
    const filtered = kind ? matches.filter(m => m.kind === kind) : matches;
    signalActivity('search_text', 0);
    if (filtered.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No content matches for "${query}"\n\n**Coverage note**: content_fts indexes string literals and comments. For symbol names use \`search_graph\`. Run **Re-index Workspace** if results seem missing.`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(filtered, null, 2),
      }],
    };
  },
);

// ── Tool: get_agent_memory ────────────────────────────────────────────────────
server.tool(
  'get_agent_memory',
  'Read a persistent memory value bound to this agent.',
  { agent_id: z.string(), key: z.string() },
  async ({ agent_id, key }) => {
    signalActivity('get_agent_memory', 0);
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
    signalActivity('set_agent_memory', 0);
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
    signalActivity('get_stats', 0);
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

// ── rg fallback ───────────────────────────────────────────────────────────────

function rgFallbackNodes(query: string, limit: number): Array<{
  id: string; name: string; type: string; file_path: string;
  start_line: number; end_line: number; code_snippet: string; node_hash: string;
  language: string; metadata: Record<string, unknown>;
}> {
  if (!WORKSPACE) return [];
  const result = spawnSync('rg', [
    '--json', '-n', '-i', '--max-count', '3',
    '-g', '*.{ts,tsx,js,jsx,rs,go,py}',
    '--', query, WORKSPACE,
  ], { encoding: 'utf8', timeout: 5000 });
  if (result.error || !result.stdout) return [];

  const prefix = WORKSPACE.endsWith('/') ? WORKSPACE : `${WORKSPACE}/`;
  const nodes: ReturnType<typeof rgFallbackNodes> = [];

  for (const line of result.stdout.split('\n')) {
    if (nodes.length >= limit) break;
    let parsed: { type?: string; data?: Record<string, unknown> };
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type !== 'match' || !parsed.data) continue;

    const data = parsed.data as Record<string, unknown>;
    const absFile = (data.path as Record<string,string>)?.text ?? '';
    const lineNum = (data.line_number as number) ?? 0;
    const matchedLine = ((data.lines as Record<string,string>)?.text ?? '').trim();
    const relFile = absFile.startsWith(prefix) ? absFile.slice(prefix.length) : absFile;

    const nodeType = inferNodeType(matchedLine);
    const nodeName = inferName(matchedLine, query) ?? query;

    nodes.push({
      id: `${relFile}:${nodeType}:${nodeName}:${lineNum}`,
      name: nodeName,
      type: nodeType,
      file_path: relFile,
      start_line: lineNum,
      end_line: lineNum,
      code_snippet: matchedLine.slice(0, 120),
      node_hash: '',
      language: '',
      metadata: {},
    });
  }
  return nodes;
}

function inferNodeType(line: string): string {
  if (line.includes('function ') || line.includes('=> {') || line.includes('fn ')) return 'function';
  if (line.includes('class ')) return 'class';
  if (line.includes('interface ')) return 'interface';
  if (line.includes('export default') || line.includes('module.exports')) return 'export';
  return 'symbol';
}

function inferName(line: string, query: string): string | null {
  const fnMatch = line.match(/function\s+([A-Za-z_]\w*)/);
  if (fnMatch) return fnMatch[1];
  const rustFnMatch = line.match(/fn\s+([A-Za-z_]\w*)/);
  if (rustFnMatch) return rustFnMatch[1];
  for (const kw of ['const ', 'let ', 'var ']) {
    const idx = line.indexOf(kw);
    if (idx !== -1) {
      const name = line.slice(idx + kw.length).match(/^([A-Za-z_]\w*)/)?.[1] ?? '';
      if (name && name.toLowerCase().includes(query.toLowerCase())) return name;
    }
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function signalActivity(toolName: string, served = 0): void {
  try {
    const raw = db.getAgentMemory('__system', 'query_stats');
    const stats = raw ? (JSON.parse(raw) as { total: number; token_savings: number }) : { total: 0, token_savings: 0 };
    stats.total++;
    stats.token_savings += served * 200;
    db.setAgentMemory('__system', 'query_stats', JSON.stringify(stats), null);
    writeFileSync(ACTIVITY_PATH, JSON.stringify({ tool: toolName, ts: Date.now(), served }));
  } catch {
    // Non-fatal — extension host may not be running
  }
}

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


// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
