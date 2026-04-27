/**
 * Benchmark DeepGrep MCP tools against grep/rg on the real-world 10bis-next project.
 * Tests the tools that matter most for an AI agent working on this codebase.
 */

import { spawnSync, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEEPGREP_ROOT = resolve(__dirname, '..');
const WORKSPACE     = '/Users/danny.braunstein/Desktop/10bis-next';
const DB_PATH       = `${WORKSPACE}/.deepgrep/graph.db`;
const MCP_BIN       = `${DEEPGREP_ROOT}/target/release/deepgrep-mcp`;
const CLAUDE_BIN    = '/Users/danny.braunstein/.vscode/extensions/anthropic.claude-code-2.1.120-darwin-arm64/resources/native-binary/claude';

const ENV = {
  DEEPGREP_DB_PATH:     DB_PATH,
  DEEPGREP_WORKSPACE:   WORKSPACE,
  DEEPGREP_TOKEN_BUDGET:'4000',
  CLAUDE_CODE_EXECPATH: CLAUDE_BIN,
};

function mcpCall(toolName, args) {
  const init = JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'bench', version:'0' } } });
  const call = JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:toolName, arguments:args } });
  const t0 = performance.now();
  const r = spawnSync(MCP_BIN, [], { input: init+'\n'+call+'\n', env:{ ...process.env, ...ENV }, encoding:'utf8', timeout:15000 });
  const ms = Math.round(performance.now() - t0);
  const lines = (r.stdout||'').trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  let text = '(no output)', isError = false;
  try { const p = JSON.parse(last); text = p?.result?.content?.[0]?.text ?? '(empty)'; isError = p?.result?.isError ?? false; } catch {}
  return { ms, text, isError, chars: text.length, tokens: Math.ceil(text.length/4) };
}

function grep(pattern, dir) {
  const t0 = performance.now();
  let raw = '';
  try { raw = execSync(`grep -rn --include="*.ts" --include="*.tsx" --include="*.js" -E "${pattern}" ${dir} 2>/dev/null`, { encoding:'utf8', timeout:10000 }); }
  catch (e) { raw = e.stdout||''; }
  return { ms: Math.round(performance.now()-t0), tokens: Math.ceil(raw.length/4), lines: raw.split('\n').filter(Boolean).length };
}

const SCENARIOS = [
  // ── Symbol search ──────────────────────────────────────────────────────────────
  { label:'Symbol: "Checkout"',         tool:'search_graph',           dgArgs:{ query:'Checkout', limit:8 },               blFn:()=>grep('\\bCheckout\\b', `${WORKSPACE}/src`), cat:'symbol' },
  { label:'Symbol: "Restaurant"',       tool:'search_graph',           dgArgs:{ query:'Restaurant', limit:8 },             blFn:()=>grep('\\bRestaurant\\b', `${WORKSPACE}/src`), cat:'symbol' },
  { label:'Symbol: "OrderSuccessData"', tool:'search_graph',           dgArgs:{ query:'OrderSuccessData', limit:8 },       blFn:()=>grep('OrderSuccessData', `${WORKSPACE}/src`), cat:'symbol' },
  // ── Callers/callees ────────────────────────────────────────────────────────────
  { label:'Context: "Checkout" component', tool:'get_context_for_symbol', dgArgs:{ symbol:'Checkout', file_path:'Checkout.js' }, blFn:()=>grep('Checkout', `${WORKSPACE}/src/checkout`), cat:'context' },
  { label:'Context: "getErrorByActionSuggestion"', tool:'get_context_for_symbol', dgArgs:{ symbol:'getErrorByActionSuggestion' }, blFn:()=>grep('getErrorByActionSuggestion', `${WORKSPACE}/src`), cat:'context' },
  // ── Dep chain ─────────────────────────────────────────────────────────────────
  { label:'DepChain: "Checkout" (49 deps)', tool:'get_dependency_chain', dgArgs:{ symbol:'Checkout', file_path:'Checkout.js' }, blFn:()=>grep('Checkout', `${WORKSPACE}/src/checkout`), cat:'dep-chain' },
  // ── Related nodes (slim auto) ─────────────────────────────────────────────────
  { label:'Related: checkout/ (2 hops, slim)', tool:'find_related_nodes', dgArgs:{ file_path:'Checkout.js', hops:2 }, blFn:()=>grep('Checkout', `${WORKSPACE}/src/checkout`), cat:'related' },
  { label:'Related: checkout/ (1 hop, full)', tool:'find_related_nodes', dgArgs:{ file_path:'Checkout.js', hops:1, slim:false }, blFn:()=>grep('Checkout', `${WORKSPACE}/src/checkout`), cat:'related' },
  // ── FTS text search ───────────────────────────────────────────────────────────
  { label:'FTS: "restaurant not found"', tool:'search_text', dgArgs:{ query:'restaurant not found', limit:10 }, blFn:()=>grep('restaurant not found', `${WORKSPACE}/src`), cat:'text-search' },
  { label:'FTS: "payment"',             tool:'search_text', dgArgs:{ query:'payment', limit:10 }, blFn:()=>grep('payment', `${WORKSPACE}/src`), cat:'text-search' },
  // ── Live rg (only DG can do this) ─────────────────────────────────────────────
  { label:'rg: API_BASE_URL in env files', tool:'search_rg', dgArgs:{ query:'API_BASE_URL', glob:'*.env', limit:10 }, blFn:()=>grep('API_BASE_URL', WORKSPACE), cat:'live-rg' },
  { label:'rg: "sentry" in config',      tool:'search_rg', dgArgs:{ query:'sentry', glob:'*.{json,js,ts}', limit:10 }, blFn:()=>grep('sentry', `${WORKSPACE}/src`), cat:'live-rg' },
];

console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
console.log('║     DeepGrep — Real-World Benchmark on 10bis-next (1730 files, 27k nodes)      ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

const col = (s, w) => String(s).padEnd(w).slice(0, w);
console.log(col('Scenario', 40) + col('Tool', 26) + col('DG ms', 8) + col('DG tok', 8) + col('BL ms', 8) + col('BL tok', 8) + 'Winner');
console.log('─'.repeat(115));

const results = [];
let dgWins = 0, blWins = 0, ties = 0;

for (const sc of SCENARIOS) {
  const dg = mcpCall(sc.tool, sc.dgArgs);
  const bl = sc.blFn();

  const dgScore = dg.tokens * 0.7 + dg.ms * 0.3;
  const blScore = bl.tokens * 0.7 + bl.ms * 0.3;
  const diff = Math.abs(dgScore - blScore);
  const winner = diff < 30 ? 'tie' : dgScore < blScore ? 'deepgrep' : 'baseline';
  const tag = winner === 'deepgrep' ? '✓ DG' : winner === 'baseline' ? '✗ BL' : '~ tie';

  if (winner === 'deepgrep') dgWins++;
  else if (winner === 'baseline') blWins++;
  else ties++;

  const savePct = bl.tokens > 0 ? Math.round((1 - dg.tokens/bl.tokens)*100) : 0;
  const speedup = bl.ms > 0 ? (bl.ms/dg.ms).toFixed(1)+'x' : '-';
  const detail = dg.isError ? `ERROR: ${dg.text.slice(50,100)}` :
                 winner === 'deepgrep' ? `${savePct}% fewer tokens, ${speedup} faster` :
                 winner === 'baseline' ? 'baseline smaller' : 'within margin';

  console.log(col(sc.label, 40) + col(sc.tool, 26) + col(dg.ms+'ms', 8) + col(dg.tokens, 8) + col(bl.ms+'ms', 8) + col(bl.tokens, 8) + `${tag}  (${detail})`);
  results.push({ ...sc, dg:{ ms:dg.ms, tokens:dg.tokens, isError:dg.isError, preview:dg.text.slice(0,250) }, bl:{ ms:bl.ms, tokens:bl.tokens }, winner, savePct, speedup });
}

console.log('─'.repeat(115));

const avgDgMs = Math.round(results.reduce((s,r)=>s+r.dg.ms,0)/results.length);
const avgBlMs = Math.round(results.reduce((s,r)=>s+r.bl.ms,0)/results.length);
const avgDgTok = Math.round(results.reduce((s,r)=>s+r.dg.tokens,0)/results.length);
const avgBlTok = Math.round(results.reduce((s,r)=>s+r.bl.tokens,0)/results.length);
const overallSave = Math.round((1-avgDgTok/avgBlTok)*100);
const overallSpeed = (avgBlMs/avgDgMs).toFixed(1);

console.log(`\nSUMMARY`);
console.log(`  DeepGrep — avg: ${avgDgMs}ms / ${avgDgTok} tokens   wins: ${dgWins}/${SCENARIOS.length}`);
console.log(`  Baseline — avg: ${avgBlMs}ms / ${avgBlTok} tokens   wins: ${blWins}/${SCENARIOS.length}  ties: ${ties}`);
console.log(`\n  DeepGrep is ${overallSpeed}x faster, ${overallSave}% fewer tokens on this real-world project.\n`);

// Per-category
const cats = [...new Set(results.map(r=>r.cat))];
console.log('PER-CATEGORY:');
for (const cat of cats) {
  const cr = results.filter(r=>r.cat===cat);
  const wins = cr.filter(r=>r.winner==='deepgrep').length;
  const avgSave = Math.round(cr.reduce((s,r)=>s+r.savePct,0)/cr.length);
  console.log(`  ${cat.padEnd(14)} DG wins: ${wins}/${cr.length}  avg token saving: ${avgSave}%`);
}

const outDir = resolve(__dirname,'results');
mkdirSync(outDir,{recursive:true});
const outPath = resolve(outDir, `10bis-benchmark-${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify({ run_at:new Date().toISOString(), workspace:WORKSPACE, summary:{dgWins,blWins,ties,total:SCENARIOS.length,avgDgMs,avgBlMs,avgDgTok,avgBlTok,overallSave,overallSpeed:parseFloat(overallSpeed)}, results }, null, 2));
console.log(`\nResults saved → ${outPath}`);
