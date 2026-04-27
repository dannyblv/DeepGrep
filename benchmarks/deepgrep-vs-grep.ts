/**
 * Benchmark 1: DeepGrep structured graph queries vs raw grep/find.
 *
 * Methodology
 * ───────────
 * 1. Index the DeepGrep source tree using TreeSitterIndexer into an in-memory DB.
 * 2. For each query scenario, run both approaches and measure:
 *    - Wall-clock latency (ms)
 *    - Token estimate (response_chars / 4)
 *    - Result count (symbols / lines returned)
 *    - Whether results are structured (parseable by a downstream agent)
 * 3. Determine the winner per query and compute aggregate summary.
 * 4. Write results to benchmarks/results/deepgrep-vs-grep-<timestamp>.json
 */

import { execSync } from 'child_process';
import { resolve, relative } from 'path';
import { readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type { QueryResult, BenchmarkSuite } from './shared';
import { tokenEstimate, pickWinner, printTable } from './shared';
import { GraphDatabase } from '../packages/extension/src/db/GraphDatabase';
import { TreeSitterIndexer } from '../packages/extension/src/indexer/TreeSitterIndexer';

// ── Configuration ─────────────────────────────────────────────────────────────

const WORKSPACE = resolve(__dirname, '..');
const SRC_DIRS = [
  resolve(WORKSPACE, 'packages/extension/src'),
  resolve(WORKSPACE, 'packages/mcp-server/src'),
];
const GRAMMARS_DIR = resolve(WORKSPACE, 'packages/extension/grammars');

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectTs(full));
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
      results.push(full);
  }
  return results;
}

function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: Math.round(performance.now() - start) };
}

async function timedAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

// ── Grep baseline ─────────────────────────────────────────────────────────────

function grepQuery(pattern: string, dirs: string[]): QueryResult {
  const { result: raw, ms } = timed(() => {
    try {
      return execSync(
        `grep -rn --include="*.ts" --include="*.js" -E "${pattern}" ${dirs.join(' ')} 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 },
      );
    } catch (e: unknown) {
      // grep exits 1 when no matches — still a valid result
      return (e as { stdout?: string }).stdout ?? '';
    }
  });

  const lines = raw.split('\n').filter(Boolean);
  const hits = lines.map(l => l.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i);
  return {
    query: pattern,
    latency_ms: ms,
    result_count: lines.length,
    raw_chars: raw.length,
    token_estimate: tokenEstimate(raw),
    structured: false,
    hits,
  };
}

function findQuery(pattern: string, dirs: string[]): QueryResult {
  const { result: raw, ms } = timed(() => {
    try {
      return execSync(
        `find ${dirs.join(' ')} -name "${pattern}" -not -path "*/node_modules/*" 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 },
      );
    } catch {
      return '';
    }
  });
  const lines = raw.split('\n').filter(Boolean);
  return {
    query: pattern,
    latency_ms: ms,
    result_count: lines.length,
    raw_chars: raw.length,
    token_estimate: tokenEstimate(raw),
    structured: false,
    hits: lines,
  };
}

// ── DeepGrep queries ──────────────────────────────────────────────────────────

function dgSearchNodes(db: GraphDatabase, query: string): QueryResult {
  const { result: nodes, ms } = timed(() => db.searchNodes(query, 20));
  const text = JSON.stringify(nodes.map(compact), null, 2);
  return {
    query,
    latency_ms: ms,
    result_count: nodes.length,
    raw_chars: text.length,
    token_estimate: tokenEstimate(text),
    structured: true,
    hits: nodes.map(n => `${n.name} @ ${n.file_path}:${n.start_line}`),
  };
}

function dgGetContext(db: GraphDatabase, symbol: string): QueryResult {
  const { result, ms } = timed(() => {
    const candidates = db.searchNodes(symbol, 5);
    const node = candidates[0];
    if (!node) return { node: null, callers: [], callees: [] };
    const callers = db.getIncoming(node.id).map(e => db.getNode(e.source_id)).filter(Boolean);
    const callees = db.getOutgoing(node.id).map(e => db.getNode(e.target_id)).filter(Boolean);
    return {
      node: compact(node),
      callers: callers.map(n => compact(n!)),
      callees: callees.map(n => compact(n!)),
    };
  });
  const text = JSON.stringify(result, null, 2);
  const total = result.callers.length + result.callees.length + (result.node ? 1 : 0);
  return {
    query: symbol,
    latency_ms: ms,
    result_count: total,
    raw_chars: text.length,
    token_estimate: tokenEstimate(text),
    structured: true,
    hits: [
      ...(result.node ? [`${result.node.name} @ ${result.node.file}:${result.node.lines}`] : []),
      ...result.callers.map((n: CompactNode) => `caller: ${n.name}`),
      ...result.callees.map((n: CompactNode) => `callee: ${n.name}`),
    ],
  };
}

function dgDependencyChain(db: GraphDatabase, symbol: string): QueryResult {
  const { result, ms } = timed(() => {
    const candidates = db.searchNodes(symbol, 3);
    const node = candidates[0];
    if (!node) return { start: null, deps: [] };
    const depIds = db.getDependencyChain(node.id);
    const deps = depIds.map(id => db.getNode(id)).filter(Boolean);
    return { start: compact(node), deps: deps.map(n => compact(n!)) };
  });
  const text = JSON.stringify(result, null, 2);
  return {
    query: symbol,
    latency_ms: ms,
    result_count: result.deps.length,
    raw_chars: text.length,
    token_estimate: tokenEstimate(text),
    structured: true,
    hits: result.deps.map((n: CompactNode) => `${n.name} (${n.type})`),
  };
}

type CompactNode = { name: string; type: string; file: string; lines: string };

function compact(n: { name: string; type: string; file_path: string; start_line: number; end_line: number }): CompactNode {
  return { name: n.name, type: n.type, file: n.file_path, lines: `${n.start_line}-${n.end_line}` };
}

function dgRelatedNodes(db: GraphDatabase, filePath: string, hops: number): QueryResult {
  const { result, ms } = timed(() => {
    const nodes = db.getNodesForFile(filePath);
    const startId = nodes.find(n => n.type === 'file')?.id ?? nodes[0]?.id ?? null;
    if (!startId) return [];
    return db
      .getNeighbourhood(startId, hops)
      .map(id => db.getNode(id))
      .filter(Boolean)
      // drop bare import-path nodes — noise for an agent editing code
      .filter((n): n is NonNullable<typeof n> => n!.type !== 'import');
  });
  // compact format — matches what the real MCP find_related_nodes tool sends
  const text = JSON.stringify(result.map(n => compact(n!)), null, 2);
  return {
    query: `related(${filePath}, hops=${hops})`,
    latency_ms: ms,
    result_count: result.length,
    raw_chars: text.length,
    token_estimate: tokenEstimate(text),
    structured: true,
    hits: result.map((n) => `${n!.name} @ ${n!.file_path}`),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n[Benchmark 1] DeepGrep vs grep — indexing source tree...');

  // ── Index ──────────────────────────────────────────────────────────────────
  const dbPath = resolve(tmpdir(), `deepgrep-bench-${Date.now()}.db`);
  const db = new GraphDatabase(dbPath);
  const indexer = new TreeSitterIndexer();

  const indexStart = performance.now();
  await indexer.init(GRAMMARS_DIR);

  const files = SRC_DIRS.flatMap(collectTs);
  console.log(`  Indexing ${files.length} source files...`);

  // Two-pass: insert all nodes first so FK constraints don't fail on edges
  const allResults = files.map(f => indexer.indexFile(f, WORKSPACE));
  for (const { nodes } of allResults) for (const n of nodes) db.upsertNode(n);
  let nodeCount = allResults.reduce((s, r) => s + r.nodes.length, 0);
  let edgeCount = 0;
  for (const { edges } of allResults) {
    for (const e of edges) {
      try { db.upsertEdge(e); edgeCount++; } catch { /* skip orphan edges */ }
    }
  }
  db.rebuildFts(); // sync FTS5 index after bulk insert

  const indexTimeMs = Math.round(performance.now() - indexStart);
  console.log(`  Indexed ${nodeCount} nodes, ${edgeCount} edges in ${indexTimeMs}ms\n`);

  // ── Query scenarios ────────────────────────────────────────────────────────
  const QUERIES: Array<{
    label: string;
    dg: () => QueryResult;
    bl: () => QueryResult;
  }> = [
    {
      label: 'Symbol search: searchNodes',
      dg: () => dgSearchNodes(db, 'searchNodes'),
      bl: () => grepQuery('searchNodes', SRC_DIRS.map(String)),
    },
    {
      label: 'Callers + callees: indexFile',
      dg: () => dgGetContext(db, 'indexFile'),
      bl: () => grepQuery('indexFile', SRC_DIRS.map(String)),
    },
    {
      label: 'Dependency chain: GraphDatabase',
      dg: () => dgDependencyChain(db, 'GraphDatabase'),
      bl: () => grepQuery('GraphDatabase', SRC_DIRS.map(String)),
    },
    {
      label: 'Related nodes: McpServerProvider',
      dg: () =>
        dgRelatedNodes(
          db,
          relative(WORKSPACE, resolve(WORKSPACE, 'packages/extension/src/mcp/McpServerProvider.ts')),
          2,
        ),
      bl: () => grepQuery('McpServerProvider', SRC_DIRS.map(String)),
    },
    {
      label: 'Fuzzy search: signal',
      dg: () => dgSearchNodes(db, 'signal'),
      bl: () => grepQuery('\\bsignal\\w*', SRC_DIRS.map(String)),
    },
    {
      label: 'File discovery: *.ts files',
      dg: () => {
        const { result: nodes, ms } = timed(() =>
          db.searchNodes('', 200).filter(n => n.type === 'file'),
        );
        const text = JSON.stringify(nodes, null, 2);
        return {
          query: 'file nodes',
          latency_ms: ms,
          result_count: nodes.length,
          raw_chars: text.length,
          token_estimate: tokenEstimate(text),
          structured: true,
          hits: nodes.map(n => n.file_path),
        };
      },
      bl: () => findQuery('*.ts', SRC_DIRS.map(String)),
    },
  ];

  const suiteQueries: BenchmarkSuite['queries'] = [];

  for (const q of QUERIES) {
    const dg = q.dg();
    const bl = q.bl();
    const { winner, reason } = pickWinner(dg, bl);
    suiteQueries.push({ label: q.label, deepgrep: dg, baseline: bl, winner, winner_reason: reason });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const avgLatency = (arr: QueryResult[]) =>
    arr.reduce((s, r) => s + r.latency_ms, 0) / arr.length;
  const avgTokens = (arr: QueryResult[]) =>
    arr.reduce((s, r) => s + r.token_estimate, 0) / arr.length;

  const dgResults = suiteQueries.map(q => q.deepgrep);
  const blResults = suiteQueries.map(q => q.baseline);

  const suite: BenchmarkSuite = {
    name: 'DeepGrep vs grep/find',
    description:
      'Compares structured AST-graph queries (DeepGrep) against raw grep/find on the DeepGrep source tree.',
    run_at: new Date().toISOString(),
    index_time_ms: indexTimeMs,
    node_count: nodeCount,
    edge_count: edgeCount,
    queries: suiteQueries,
    summary: {
      deepgrep_avg_latency_ms: avgLatency(dgResults),
      baseline_avg_latency_ms: avgLatency(blResults),
      deepgrep_avg_tokens: avgTokens(dgResults),
      baseline_avg_tokens: avgTokens(blResults),
      deepgrep_wins: suiteQueries.filter(q => q.winner === 'deepgrep').length,
      baseline_wins: suiteQueries.filter(q => q.winner === 'baseline').length,
    },
  };

  printTable(suite);

  const outPath = resolve(
    __dirname,
    'results',
    `deepgrep-vs-grep-${Date.now()}.json`,
  );
  writeFileSync(outPath, JSON.stringify(suite, null, 2));
  console.log(`Results saved → ${outPath}\n`);

  db.close();
  return suite;
}

export { main };

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
