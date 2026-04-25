/**
 * Benchmark orchestrator — runs both suites sequentially and prints a
 * combined verdict to stdout. Results are also written to benchmarks/results/.
 *
 * Usage:
 *   npx ts-node --project benchmarks/tsconfig.json benchmarks/run.ts
 *   VEXP_API_KEY=xxx VEXP_REPO_ID=yyy npx ts-node ... benchmarks/run.ts
 */

import { main as runGrepBench } from './deepgrep-vs-grep';
import { main as runVexpBench } from './deepgrep-vs-vexp';
import type { BenchmarkSuite } from './shared';

async function run() {
  const suites: BenchmarkSuite[] = [];

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         DeepGrep Benchmark Suite                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── Benchmark 1 ────────────────────────────────────────────────────────────
  console.log('\n▶ Running Benchmark 1: DeepGrep vs grep/find...');
  const grepSuite = await runGrepBench();
  suites.push(grepSuite);

  // ── Benchmark 2 ────────────────────────────────────────────────────────────
  console.log('\n▶ Running Benchmark 2: DeepGrep vs vexp.dev...');
  const vexpSuite = await runVexpBench();
  suites.push(vexpSuite);

  // ── Combined verdict ────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                COMBINED VERDICT                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const s of suites) {
    const totalQueries = s.queries.length;
    const dgWins = s.summary.deepgrep_wins;
    const blWins = s.summary.baseline_wins;
    const ties = totalQueries - dgWins - blWins;
    const speedup = (s.summary.baseline_avg_latency_ms / s.summary.deepgrep_avg_latency_ms).toFixed(2);
    const tokenSave = (
      ((s.summary.baseline_avg_tokens - s.summary.deepgrep_avg_tokens) /
        s.summary.baseline_avg_tokens) *
      100
    ).toFixed(1);

    console.log(`  Suite: ${s.name}`);
    console.log(`    DeepGrep wins : ${dgWins}/${totalQueries}  (${ties} ties, ${blWins} baseline wins)`);
    console.log(`    Speed advantage  : ${speedup}x faster on average`);
    console.log(`    Token advantage  : ${tokenSave}% fewer tokens per query`);
    console.log(`    Structured output: DeepGrep always returns typed graph nodes`);
    console.log('');
  }

  const allDgWins = suites.reduce((a, s) => a + s.summary.deepgrep_wins, 0);
  const allTotal = suites.reduce((a, s) => a + s.queries.length, 0);
  console.log(
    `  Overall: DeepGrep won ${allDgWins}/${allTotal} query comparisons across both benchmarks.\n`,
  );
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
