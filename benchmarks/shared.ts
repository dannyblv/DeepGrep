/**
 * Shared types and utilities for DeepGrep benchmarks.
 */

export interface QueryResult {
  query: string;
  latency_ms: number;
  result_count: number;
  raw_chars: number;
  token_estimate: number;
  structured: boolean;
  hits: string[]; // symbol names / file paths found
}

export interface BenchmarkSuite {
  name: string;
  description: string;
  run_at: string; // ISO timestamp
  index_time_ms: number | null;
  node_count: number | null;
  edge_count: number | null;
  queries: {
    label: string;
    deepgrep: QueryResult;
    baseline: QueryResult;
    winner: 'deepgrep' | 'baseline' | 'tie';
    winner_reason: string;
  }[];
  summary: {
    deepgrep_avg_latency_ms: number;
    baseline_avg_latency_ms: number;
    deepgrep_avg_tokens: number;
    baseline_avg_tokens: number;
    deepgrep_wins: number;
    baseline_wins: number;
  };
}

export function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

export function pickWinner(
  dg: QueryResult,
  bl: QueryResult,
): { winner: 'deepgrep' | 'baseline' | 'tie'; reason: string } {
  // Score: lower tokens AND faster wins. Structured data preferred over raw text.
  const dgScore =
    dg.token_estimate * 0.6 + dg.latency_ms * 0.4 - (dg.structured ? 500 : 0);
  const blScore =
    bl.token_estimate * 0.6 + bl.latency_ms * 0.4 - (bl.structured ? 500 : 0);

  if (Math.abs(dgScore - blScore) < 50)
    return { winner: 'tie', reason: 'scores within 50 points' };
  if (dgScore < blScore) {
    const reasons: string[] = [];
    if (dg.token_estimate < bl.token_estimate)
      reasons.push(
        `${Math.round(((bl.token_estimate - dg.token_estimate) / bl.token_estimate) * 100)}% fewer tokens`,
      );
    if (dg.latency_ms < bl.latency_ms)
      reasons.push(`${Math.round(bl.latency_ms - dg.latency_ms)}ms faster`);
    if (dg.structured && !bl.structured) reasons.push('structured output');
    return { winner: 'deepgrep', reason: reasons.join(', ') || 'better score' };
  }
  const reasons: string[] = [];
  if (bl.token_estimate < dg.token_estimate)
    reasons.push(
      `${Math.round(((dg.token_estimate - bl.token_estimate) / dg.token_estimate) * 100)}% fewer tokens`,
    );
  if (bl.latency_ms < dg.latency_ms)
    reasons.push(`${Math.round(dg.latency_ms - bl.latency_ms)}ms faster`);
  return { winner: 'baseline', reason: reasons.join(', ') || 'better score' };
}

export function printTable(suite: BenchmarkSuite): void {
  const sep = '─'.repeat(120);
  console.log(`\n${'═'.repeat(120)}`);
  console.log(`  BENCHMARK: ${suite.name}`);
  console.log(`  ${suite.description}`);
  console.log(`  Run at: ${suite.run_at}`);
  if (suite.node_count !== null) {
    console.log(
      `  Index: ${suite.node_count} nodes, ${suite.edge_count} edges (built in ${suite.index_time_ms}ms)`,
    );
  }
  console.log(`${'═'.repeat(120)}\n`);

  const col = (s: string, w: number) => s.padEnd(w).slice(0, w);

  console.log(
    col('Query', 32) +
      col('Approach', 14) +
      col('Latency', 10) +
      col('Tokens', 10) +
      col('Results', 10) +
      col('Structured', 11) +
      'Winner',
  );
  console.log(sep);

  for (const q of suite.queries) {
    const winTag =
      q.winner === 'deepgrep'
        ? '✓ DeepGrep'
        : q.winner === 'baseline'
          ? '✓ Baseline'
          : '  Tie';
    console.log(
      col(q.label, 32) +
        col('DeepGrep', 14) +
        col(`${q.deepgrep.latency_ms}ms`, 10) +
        col(`${q.deepgrep.token_estimate}`, 10) +
        col(`${q.deepgrep.result_count}`, 10) +
        col(q.deepgrep.structured ? 'yes' : 'no', 11) +
        `${winTag}  (${q.winner_reason})`,
    );
    console.log(
      col('', 32) +
        col('Baseline', 14) +
        col(`${q.baseline.latency_ms}ms`, 10) +
        col(`${q.baseline.token_estimate}`, 10) +
        col(`${q.baseline.result_count}`, 10) +
        col(q.baseline.structured ? 'yes' : 'no', 11),
    );
    console.log(sep);
  }

  const s = suite.summary;
  console.log('\nSUMMARY');
  console.log(
    `  DeepGrep  — avg latency: ${s.deepgrep_avg_latency_ms.toFixed(1)}ms  avg tokens: ${s.deepgrep_avg_tokens.toFixed(0)}  wins: ${s.deepgrep_wins}`,
  );
  console.log(
    `  Baseline  — avg latency: ${s.baseline_avg_latency_ms.toFixed(1)}ms  avg tokens: ${s.baseline_avg_tokens.toFixed(0)}  wins: ${s.baseline_wins}`,
  );
  const speedup = (s.baseline_avg_latency_ms / s.deepgrep_avg_latency_ms).toFixed(2);
  const tokenSavePct = (
    ((s.baseline_avg_tokens - s.deepgrep_avg_tokens) / s.baseline_avg_tokens) *
    100
  ).toFixed(1);
  console.log(
    `\n  DeepGrep is ${speedup}x faster on average, using ${tokenSavePct}% fewer tokens.\n`,
  );
}
