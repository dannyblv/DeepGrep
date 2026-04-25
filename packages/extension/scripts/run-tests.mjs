/**
 * Test runner that handles the better-sqlite3 native binding version mismatch.
 *
 * better-sqlite3 is compiled for VS Code's Electron by `pnpm rebuild-native`.
 * Unit tests run in plain Node.js, which needs a different binary.
 * This script: copy grammars → rebuild for Node.js → run mocha → rebuild for Electron (restore).
 */
import { execSync, spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, '..');
const rootDir = join(extDir, '..', '..');
const req = createRequire(import.meta.url);

// Locate better-sqlite3 package directory via require.resolve
const sqlitePkgDir = dirname(req.resolve('better-sqlite3/package.json'));

function run(cmd, cwd = extDir) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// ── Step 0: ensure Tree-sitter grammar .wasm files are present ────────────
// grammars/ is gitignored (generated at build time) — copy from tree-sitter-wasms
// so tests can run before the full build step.
console.log('\n── Ensuring Tree-sitter grammar files ───────────────────────');
{
  const grammarsDir = join(extDir, 'grammars');
  const wasmsSrcDir = join(dirname(req.resolve('tree-sitter-wasms/package.json')), 'out');
  console.log(`  source: ${wasmsSrcDir}`);
  console.log(`  dest:   ${grammarsDir}`);
  const langs = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust'];
  mkdirSync(grammarsDir, { recursive: true });
  let copied = 0, missing = 0;
  for (const lang of langs) {
    const src = join(wasmsSrcDir, `tree-sitter-${lang}.wasm`);
    const dst = join(grammarsDir, `tree-sitter-${lang}.wasm`);
    if (existsSync(src)) {
      copyFileSync(src, dst);  // always overwrite to keep versions in sync
      copied++;
    } else {
      console.warn(`  MISSING: ${src}`);
      missing++;
    }
  }
  console.log(`  ${copied} grammars ready, ${missing} missing`);
  if (missing > 0) {
    console.error('  ERROR: grammar files missing — TreeSitter tests will fail');
    process.exit(1);
  }
}

// ── Step 1: rebuild for current Node.js ───────────────────────────────────
console.log('\n── Rebuilding better-sqlite3 for plain Node.js ─────────────');
run('npm run build-release', sqlitePkgDir);

// ── Step 2: run the test suite ────────────────────────────────────────────
console.log('── Running tests ────────────────────────────────────────────\n');
const result = spawnSync(
  process.execPath,                               // current node binary
  [join(extDir, 'node_modules/mocha/bin/mocha')], // mocha JS entry point
  { cwd: extDir, stdio: 'inherit' },
);

// ── Step 3: restore Electron build (best-effort) ──────────────────────────
console.log('\n── Restoring better-sqlite3 for Electron (VS Code) ─────────');
try {
  run('node ../../scripts/rebuild-native.mjs');
} catch {
  console.warn('⚠  Electron restore skipped (VS Code not found) — run `pnpm rebuild-native` manually if needed');
}

process.exit(result.status ?? 1);
