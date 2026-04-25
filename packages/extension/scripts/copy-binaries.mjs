/**
 * Pre-package step: copies the Rust binaries from target/release into bin/
 * so vsce includes them in the .vsix.
 *
 * Binaries expected (built with `cargo build --release`):
 *   deepgrep-indexer  — AST indexer (run by the extension host)
 *   deepgrep-mcp      — MCP stdio server (run as child process) [optional]
 */

import { copyFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const extDir    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binDst    = resolve(extDir, 'bin');
const cargoOut  = resolve(extDir, '..', '..', 'target', 'release');

mkdirSync(binDst, { recursive: true });

const binaries = ['deepgrep-indexer', 'deepgrep-mcp'];

for (const name of binaries) {
  const src = resolve(cargoOut, name);
  const dst = resolve(binDst, name);
  if (!existsSync(src)) {
    if (name === 'deepgrep-indexer') {
      console.error(`ERROR: ${src} not found. Run: cargo build --release`);
      process.exit(1);
    } else {
      console.log(`  ${name}: not built, skipping`);
    }
    continue;
  }
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
  console.log(`  ${name}: copied`);
}
