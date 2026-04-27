/**
 * Benchmark all 9 MCP tools via the Rust binary.
 * Measures latency, token cost (chars/4), and practical usefulness vs rg/grep baseline.
 * Writes results to benchmarks/results/all-tools-<timestamp>.json
 */

import { spawnSync, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, '..');
const DB_PATH    = resolve(WORKSPACE, '.deepgrep/graph.db');
const MCP_BIN    = resolve(WORKSPACE, 'target/release/deepgrep-mcp');
const CLAUDE_BIN = '/Users/danny.braunstein/.vscode/extensions/anthropic.claude-code-2.1.120-darwin-arm64/resources/native-binary/claude';

const ENV = {
  DEEPGREP_DB_PATH:     DB_PATH,
  DEEPGREP_WORKSPACE:   WORKSPACE,
  DEEPGREP_TOKEN_BUDGET:'4000',
  CLAUDE_CODE_EXECPATH: CLAUDE_BIN,
};

// ── MCP call helper ────────────────────────────────────────────────────────────

function mcpCall(toolName, args) {
  const initMsg  = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '0' } } });
  const callMsg  = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } });
  const input    = initMsg + '\n' + callMsg + '\n';

  const t0 = performance.now();
  const r  = spawnSync(MCP_BIN, [], {
    input,
    env: { ...process.env, ...ENV },
    encoding: 'utf8',
    timeout: 10000,
  });
  const latencyMs = Math.round(performance.now() - t0);

  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  const last  = lines[lines.length - 1];
  let text = '(no output)';
  let isError = false;
  try {
    const parsed = JSON.parse(last);
    text    = parsed?.result?.content?.[0]?.text ?? '(empty)';
    isError = parsed?.result?.isError ?? false;
  } catch { text = last ?? '(parse error)'; }

  return { latencyMs, text, isError, chars: text.length, tokens: Math.ceil(text.length / 4) };
}

// ── Baseline: rg/grep helper ──────────────────────────────────────────────────

function rgCall(query, globs) {
  const t0 = performance.now();
  let raw = '';
  try {
    const args = ['--no-heading', '-n', '-i', ...globs.flatMap(g => ['-g', g]), '--', query, WORKSPACE];
    const result = spawnSync(MCP_BIN, [], { // Use ARGV0 trick via CLAUDE_CODE_EXECPATH
      input: '', env: { ...process.env, ...ENV }, encoding: 'utf8', timeout: 5000,
    });
    // Actual rg via direct claude binary
    const r2 = spawnSync(CLAUDE_BIN, args, {
      argv0: 'rg',
      env: { ...process.env, ...ENV },
      encoding: 'utf8',
      timeout: 5000,
    });
    raw = r2.stdout || '';
  } catch { raw = ''; }
  const latencyMs = Math.round(performance.now() - t0);
  const lines = raw.split('\n').filter(Boolean);
  return { latencyMs, text: raw, chars: raw.length, tokens: Math.ceil(raw.length / 4), lines: lines.length };
}

function grepCall(pattern, dir) {
  const t0 = performance.now();
  let raw = '';
  try {
    raw = execSync(
      `grep -rn --include="*.ts" --include="*.js" --include="*.rs" -E "${pattern}" ${dir} 2>/dev/null`,
      { encoding: 'utf8', timeout: 8000 }
    );
  } catch (e) { raw = e.stdout || ''; }
  const latencyMs = Math.round(performance.now() - t0);
  return { latencyMs, text: raw, chars: raw.length, tokens: Math.ceil(raw.length / 4), lines: raw.split('\n').filter(Boolean).length };
}

// ── Benchmark scenarios ────────────────────────────────────────────────────────

const SCENARIOS = [
  // search_graph: symbol lookup
  {
    tool: 'search_graph',
    label: 'Symbol lookup: "discover_files"',
    dgArgs: { query: 'discover_files', limit: 10 },
    blFn:   () => grepCall('discover_files', resolve(WORKSPACE, 'packages')),
    category: 'symbol-lookup',
  },
  {
    tool: 'search_graph',
    label: 'Symbol lookup: "GraphDatabase"',
    dgArgs: { query: 'GraphDatabase', limit: 10 },
    blFn:   () => grepCall('GraphDatabase', resolve(WORKSPACE, 'packages')),
    category: 'symbol-lookup',
  },
  // get_context_for_symbol: callers/callees
  {
    tool: 'get_context_for_symbol',
    label: 'Context: "dispatch"',
    dgArgs: { symbol: 'dispatch' },
    blFn:   () => grepCall('\\bdispatch\\b', resolve(WORKSPACE, 'packages')),
    category: 'callers-callees',
  },
  {
    tool: 'get_context_for_symbol',
    label: 'Context: "indexFile"',
    dgArgs: { symbol: 'indexFile' },
    blFn:   () => grepCall('indexFile', resolve(WORKSPACE, 'packages')),
    category: 'callers-callees',
  },
  // get_dependency_chain
  {
    tool: 'get_dependency_chain',
    label: 'Dep chain: "cmd_index"',
    dgArgs: { symbol: 'cmd_index' },
    blFn:   () => grepCall('cmd_index', resolve(WORKSPACE, 'packages')),
    category: 'dependency-chain',
  },
  // find_related_nodes
  {
    tool: 'find_related_nodes',
    label: 'Related nodes: walker.rs (2 hops)',
    dgArgs: { file_path: 'walker.rs', hops: 2 },
    blFn:   () => grepCall('walker', resolve(WORKSPACE, 'packages/indexer')),
    category: 'graph-traversal',
  },
  // search_text: indexed FTS
  {
    tool: 'search_text',
    label: 'FTS: "DEEPGREP_TOKEN_BUDGET"',
    dgArgs: { query: 'DEEPGREP_TOKEN_BUDGET', limit: 10 },
    blFn:   () => grepCall('DEEPGREP_TOKEN_BUDGET', resolve(WORKSPACE, 'packages')),
    category: 'text-search',
  },
  {
    tool: 'search_text',
    label: 'FTS: "schema_version"',
    dgArgs: { query: 'schema_version', limit: 10 },
    blFn:   () => grepCall('schema_version', resolve(WORKSPACE, 'packages')),
    category: 'text-search',
  },
  // search_rg: live rg — config files
  {
    tool: 'search_rg',
    label: 'rg: "deepgrep-mcp" in JSON',
    dgArgs: { query: 'deepgrep-mcp', glob: '*.json', limit: 10 },
    blFn:   () => grepCall('deepgrep-mcp', WORKSPACE),
    category: 'live-search',
  },
  {
    tool: 'search_rg',
    label: 'rg: regex pattern (schema.*[0-9])',
    dgArgs: { query: 'schema.*[0-9]', regex: true, limit: 10 },
    blFn:   () => grepCall('schema.*[0-9]', WORKSPACE),
    category: 'live-search',
  },
  // get_stats
  {
    tool: 'get_stats',
    label: 'Index health check',
    dgArgs: {},
    blFn:   () => {
      const t0 = performance.now();
      const r = spawnSync('wc', ['-l'], {
        input: execSync(`find ${WORKSPACE}/packages -name "*.ts" -o -name "*.rs" 2>/dev/null`).toString(),
        encoding: 'utf8',
      });
      const text = `Total source lines: ${r.stdout.trim()}`;
      const latencyMs = Math.round(performance.now() - t0);
      return { latencyMs, text, chars: text.length, tokens: Math.ceil(text.length / 4), lines: 1 };
    },
    category: 'meta',
  },
];

// ── Run ────────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║              DeepGrep — All MCP Tools Benchmark                            ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log(`  DB:        ${DB_PATH}`);
console.log(`  MCP bin:   ${MCP_BIN}`);
console.log(`  Workspace: ${WORKSPACE}\n`);

const results = [];
let dgWins = 0, blWins = 0, ties = 0;

const col = (s, w) => String(s).padEnd(w).slice(0, w);
const hdr = col('Scenario', 38) + col('Tool', 24) + col('DG ms', 8) + col('DG tok', 8) + col('BL ms', 8) + col('BL tok', 8) + 'Winner';
console.log(hdr);
console.log('─'.repeat(110));

for (const sc of SCENARIOS) {
  const dg = mcpCall(sc.tool, sc.dgArgs);
  const bl = sc.blFn();

  // Score: penalise tokens heavily (that's what costs money), latency matters less
  const dgScore = dg.tokens * 0.7 + dg.latencyMs * 0.3;
  const blScore = bl.tokens * 0.7 + bl.latencyMs * 0.3;
  const diff    = Math.abs(dgScore - blScore);
  const winner  = diff < 30 ? 'tie' : dgScore < blScore ? 'deepgrep' : 'baseline';
  const tag     = winner === 'deepgrep' ? '✓ DG' : winner === 'baseline' ? '✗ BL' : '~ tie';

  if (winner === 'deepgrep') dgWins++;
  else if (winner === 'baseline') blWins++;
  else ties++;

  const tokenSavePct = bl.tokens > 0 ? Math.round((1 - dg.tokens / bl.tokens) * 100) : 0;
  const speedupStr   = bl.latencyMs > 0 ? `${(bl.latencyMs / dg.latencyMs).toFixed(1)}x` : '-';

  let detail = '';
  if (winner === 'deepgrep') detail = `${tokenSavePct}% fewer tokens, ${speedupStr} faster`;
  else if (winner === 'baseline') detail = `baseline smaller/faster`;
  else detail = 'within margin';

  console.log(col(sc.label, 38) + col(sc.tool, 24) + col(dg.latencyMs + 'ms', 8) + col(dg.tokens, 8) + col(bl.latencyMs + 'ms', 8) + col(bl.tokens, 8) + `${tag}  (${detail})`);

  results.push({
    label: sc.label,
    tool: sc.tool,
    category: sc.category,
    deepgrep: { latencyMs: dg.latencyMs, tokens: dg.tokens, chars: dg.chars, isError: dg.isError, textPreview: dg.text.slice(0, 300) },
    baseline: { latencyMs: bl.latencyMs, tokens: bl.tokens, chars: bl.chars },
    winner,
    tokenSavePct,
    speedupStr,
  });
}

console.log('─'.repeat(110));

const avgDgLat  = Math.round(results.reduce((s, r) => s + r.deepgrep.latencyMs, 0) / results.length);
const avgBlLat  = Math.round(results.reduce((s, r) => s + r.baseline.latencyMs, 0) / results.length);
const avgDgTok  = Math.round(results.reduce((s, r) => s + r.deepgrep.tokens, 0) / results.length);
const avgBlTok  = Math.round(results.reduce((s, r) => s + r.baseline.tokens, 0) / results.length);
const overallSave = Math.round((1 - avgDgTok / avgBlTok) * 100);
const overallSpeed = (avgBlLat / avgDgLat).toFixed(2);

console.log('\nSUMMARY');
console.log(`  DeepGrep — avg latency: ${avgDgLat}ms   avg tokens: ${avgDgTok}   wins: ${dgWins}/${SCENARIOS.length}`);
console.log(`  Baseline — avg latency: ${avgBlLat}ms   avg tokens: ${avgBlTok}   wins: ${blWins}/${SCENARIOS.length}  ties: ${ties}`);
console.log(`\n  DeepGrep is ${overallSpeed}x faster on average, using ${overallSave}% fewer tokens.\n`);

// Per-category summary
const categories = [...new Set(results.map(r => r.category))];
console.log('PER-CATEGORY BREAKDOWN:');
for (const cat of categories) {
  const catResults = results.filter(r => r.category === cat);
  const catDgWins  = catResults.filter(r => r.winner === 'deepgrep').length;
  const catAvgSave = Math.round(catResults.reduce((s, r) => s + r.tokenSavePct, 0) / catResults.length);
  const errors     = catResults.filter(r => r.deepgrep.isError).length;
  const errNote    = errors > 0 ? ` [${errors} error(s)]` : '';
  console.log(`  ${cat.padEnd(22)} DG wins: ${catDgWins}/${catResults.length}  avg token saving: ${catAvgSave}%${errNote}`);
}

// Save
const outDir = resolve(__dirname, 'results');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `all-tools-${Date.now()}.json`);
const report = {
  run_at: new Date().toISOString(),
  mcp_binary: MCP_BIN,
  workspace: WORKSPACE,
  summary: { dgWins, blWins, ties, total: SCENARIOS.length, avgDgLatencyMs: avgDgLat, avgBlLatencyMs: avgBlLat, avgDgTokens: avgDgTok, avgBlTokens: avgBlTok, overallTokenSavePct: overallSave, overallSpeedup: parseFloat(overallSpeed) },
  results,
};
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nResults saved → ${outPath}`);
