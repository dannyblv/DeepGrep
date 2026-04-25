/**
 * Pre-package step: bundles runtime-required native packages into dist/node_modules/
 * so that vsce picks them up.
 *
 * Why dist/node_modules/?
 *   vsce's internal glob uses `ignore: 'node_modules/**'` (relative to the extension
 *   root), which silently excludes the root node_modules even when .vscodeignore tries
 *   to re-include sub-packages with negation patterns.
 *   `dist/node_modules/**` is NOT matched by that glob, so files placed there are
 *   included in the .vsix without any special treatment.
 *
 *   At runtime Node.js resolves `require('better-sqlite3')` from dist/extension.js by
 *   walking up from __dirname, so dist/node_modules/better-sqlite3 is found first.
 */

import { cpSync, lstatSync, rmSync, mkdirSync, readdirSync, realpathSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const extDir   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nmDst    = resolve(extDir, 'dist', 'node_modules');
const pnpmStore = resolve(extDir, '..', '..', 'node_modules', '.pnpm');

function copyReal(src, dst, label) {
  try {
    const real = lstatSync(src).isSymbolicLink() ? realpathSync(src) : src;
    rmSync(dst, { recursive: true, force: true });
    cpSync(real, dst, {
      recursive: true,
      dereference: true,
      filter: (s) => {
        const rel = s.slice(real.length + 1);
        if (!rel) return true;
        const skip = ['src/', 'binding.gyp', '.github/'];
        return !skip.some(p => rel.startsWith(p));
      },
    });
    console.log(`  ${label}: bundled`);
  } catch (e) {
    console.warn(`  ${label}: warning — ${e.message}`);
  }
}

/**
 * Find the real directory of a package in the pnpm virtual store by prefix-matching
 * the directory name, then returning its node_modules/<name> subdirectory.
 */
function findInPnpmStore(pkgName) {
  if (!existsSync(pnpmStore)) return null;
  // pnpm store dirs are named <pkg>@<version>[_peer...] — match by prefix
  const dirName = pkgName.replace('/', '+'); // scoped packages use + instead of /
  try {
    const entries = readdirSync(pnpmStore);
    // Sort descending so highest semver is first
    const match = entries
      .filter(e => e === dirName || e.startsWith(dirName + '@'))
      .sort()
      .reverse()[0];
    if (!match) return null;
    const candidate = resolve(pnpmStore, match, 'node_modules', pkgName);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

console.log('resolve-symlinks: bundling runtime deps into dist/node_modules/ …');
mkdirSync(nmDst, { recursive: true });

// --- better-sqlite3 ---
// After `pnpm rebuild-native` the symlink may have been replaced with a real dir;
// find the authoritative path via the pnpm store to get the Electron-rebuilt binary.
const sqliteInStore = findInPnpmStore('better-sqlite3');
const sqliteSrc = sqliteInStore ?? resolve(extDir, 'node_modules', 'better-sqlite3');
copyReal(sqliteSrc, resolve(nmDst, 'better-sqlite3'), 'better-sqlite3');

// --- bindings (hoisted peer of better-sqlite3 in pnpm store) ---
// pnpm puts bindings next to better-sqlite3 inside the virtual package dir.
const sqliteStoreDir = sqliteInStore ? dirname(sqliteInStore) : null; // .pnpm/better-sqlite3@x/node_modules
const bindingsSrc = sqliteStoreDir
  ? resolve(sqliteStoreDir, 'bindings')
  : findInPnpmStore('bindings');
if (bindingsSrc && existsSync(bindingsSrc)) {
  copyReal(bindingsSrc, resolve(nmDst, 'bindings'), 'bindings');
} else {
  console.warn('  bindings: not found in pnpm store — better-sqlite3 may fail at runtime');
}

// --- file-uri-to-path (dep of bindings, hoisted under bindings virtual package) ---
const bindingsStoreDir = findInPnpmStore('bindings') ? dirname(findInPnpmStore('bindings')) : null;
const futpSrc = bindingsStoreDir
  ? resolve(bindingsStoreDir, 'file-uri-to-path')
  : findInPnpmStore('file-uri-to-path');
if (futpSrc && existsSync(futpSrc)) {
  copyReal(futpSrc, resolve(nmDst, 'file-uri-to-path'), 'file-uri-to-path');
} else {
  console.warn('  file-uri-to-path: not found in pnpm store');
}

console.log('resolve-symlinks: done');
