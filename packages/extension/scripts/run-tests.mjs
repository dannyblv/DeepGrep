/**
 * Test runner that handles the better-sqlite3 native binding version mismatch.
 *
 * better-sqlite3 is compiled for VS Code's Electron by `pnpm rebuild-native`.
 * Unit tests run in plain Node.js, which needs a different binary.
 * This script: rebuild for Node.js → run mocha → rebuild for Electron (restore).
 */
import { execSync, spawnSync } from 'child_process';
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
