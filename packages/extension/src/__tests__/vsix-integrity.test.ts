/**
 * VSIX integrity tests.
 *
 * These tests verify that a packaged .vsix contains every artifact the
 * extension needs to run standalone (native addon, Rust binary, webview,
 * MCP server). They are skipped automatically when no .vsix is present so
 * that `pnpm test` works for developers who haven't run `pnpm package` yet.
 *
 * In CI the tests run after the package step, acting as a release gate.
 */

import assert from 'node:assert/strict';
import { describe, it, before } from 'mocha';
import { execSync } from 'child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// ── Paths ─────────────────────────────────────────────────────────────────────
// __dirname is the compiled test dir; walk up to packages/extension root

const EXT_DIR = resolve(__dirname, '..', '..');

function findVsix(): string | null {
  try {
    const files = readdirSync(EXT_DIR).filter(f => f.endsWith('.vsix'));
    if (files.length === 0) return null;
    // Prefer most recently modified
    return join(EXT_DIR, files.sort().reverse()[0]);
  } catch {
    return null;
  }
}

// ── Required paths inside the .vsix archive ───────────────────────────────────
//
// vsce produces a zip where all files live under "extension/".

const REQUIRED_PATHS = [
  // Extension entry point
  'extension/dist/extension.js',

  // MCP server bundle
  'extension/dist/mcp-server.js',

  // Webview HTML entrypoint (esbuild output goes to dist/webview/)
  'extension/dist/webview/src/index.html',

  // Rust indexer binary
  'extension/bin/deepgrep-indexer',

  // Native SQLite addon compiled for Electron ABI
  'extension/dist/node_modules/better-sqlite3/build/Release/better_sqlite3.node',

  // bindings peer dep that better-sqlite3 uses to locate the .node file
  'extension/dist/node_modules/bindings/bindings.js',

  // file-uri-to-path dep of bindings
  'extension/dist/node_modules/file-uri-to-path/index.js',

  // Extension manifest
  'extension/package.json',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function unzip(vsixPath: string, destDir: string): void {
  execSync(`unzip -q "${vsixPath}" -d "${destDir}"`, { stdio: 'pipe' });
}

function listZipEntries(vsixPath: string): string[] {
  const output = execSync(`unzip -Z1 "${vsixPath}"`, { encoding: 'utf8', stdio: 'pipe' });
  return output.trim().split('\n').filter(Boolean);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('VSIX integrity', function () {
  // Unzipping can be slow for large archives
  this.timeout(30000);

  let vsixPath: string | null;
  let extractDir: string;
  let entries: string[];

  before(function () {
    vsixPath = findVsix();
    if (!vsixPath) {
      // Skip the whole suite — developer hasn't run `pnpm package` yet
      this.skip();
    }
    extractDir = mkdtempSync(join(tmpdir(), 'dg-vsix-'));
    unzip(vsixPath!, extractDir);
    entries = listZipEntries(vsixPath!);
  });

  after(function () {
    if (extractDir) rmSync(extractDir, { recursive: true, force: true });
  });

  // ── Required file presence ────────────────────────────────────────────────

  for (const requiredPath of REQUIRED_PATHS) {
    it(`contains ${requiredPath}`, function () {
      const onDisk = join(extractDir, requiredPath);
      assert.ok(
        existsSync(onDisk),
        `${requiredPath} is missing from the .vsix.\n` +
        `Run: cd packages/extension && pnpm package`,
      );
    });
  }

  // ── Rust binary is executable ─────────────────────────────────────────────

  it('deepgrep-indexer binary is executable', function () {
    const binary = join(extractDir, 'extension/bin/deepgrep-indexer');
    if (!existsSync(binary)) this.skip();
    // --help exits 0; if binary is missing or not executable it throws
    try {
      execSync(`"${binary}" --help`, { stdio: 'pipe', timeout: 5000 });
    } catch (err: unknown) {
      // Acceptable: binary may exit non-0 for --help but must at least start
      const e = err as NodeJS.ErrnoException & { status?: number };
      if (e.code === 'ENOENT' || e.code === 'EACCES') {
        assert.fail(`deepgrep-indexer is not executable: ${e.message}`);
      }
      // Non-zero exit from --help is fine (clap-based CLIs do that)
    }
  });

  // ── Native addon has correct file extension ───────────────────────────────

  it('better_sqlite3.node has .node extension (native addon)', function () {
    const nodeFiles = entries.filter(e => e.endsWith('.node'));
    assert.ok(nodeFiles.length > 0, 'No .node file found in .vsix');
    assert.ok(
      nodeFiles.some(f => f.includes('better_sqlite3')),
      `Expected better_sqlite3.node, found: ${nodeFiles.join(', ')}`,
    );
  });

  // ── MCP server is registered in package.json ──────────────────────────────

  it('package.json does not list node_modules as a bundled dependency', function () {
    // vsce --no-dependencies is required; if someone removes it the vsix
    // would balloon in size and include devDeps
    const manifest = JSON.parse(
      require('fs').readFileSync(join(extractDir, 'extension/package.json'), 'utf8'),
    );
    // "dependencies" in the published manifest is fine, but the vsix should not
    // contain a top-level node_modules/ directory (we bundle into dist/node_modules/)
    const hasTopLevelNm = entries.some(
      e => e.startsWith('extension/node_modules/') && !e.startsWith('extension/dist/node_modules/'),
    );
    assert.ok(!hasTopLevelNm, 'top-level node_modules/ found in .vsix — use --no-dependencies');
    assert.ok(manifest.main, 'package.json must have a "main" field');
    assert.ok(manifest.engines?.vscode, 'package.json must declare VS Code engine requirement');
  });

  // ── MCP section wired correctly ───────────────────────────────────────────

  it('extension manifest declares activationEvents', function () {
    const manifest = JSON.parse(
      require('fs').readFileSync(join(extractDir, 'extension/package.json'), 'utf8'),
    );
    assert.ok(
      Array.isArray(manifest.activationEvents) && manifest.activationEvents.length > 0,
      'activationEvents must be declared so the extension activates',
    );
  });

  it('extension manifest declares at least one command', function () {
    const manifest = JSON.parse(
      require('fs').readFileSync(join(extractDir, 'extension/package.json'), 'utf8'),
    );
    assert.ok(
      Array.isArray(manifest.contributes?.commands) && manifest.contributes.commands.length > 0,
      'contributes.commands must be non-empty',
    );
  });

  // ── Webview UI assets are present ────────────────────────────────────────

  it('webview dist contains at least one JS bundle', function () {
    const webviewJs = entries.filter(
      e => e.startsWith('extension/dist/webview/') && e.endsWith('.js'),
    );
    assert.ok(webviewJs.length > 0, 'No webview JS bundle found in dist/webview/');
  });

  // ── Archive size sanity check ─────────────────────────────────────────────

  it('archive size is under 50 MB', function () {
    const { statSync } = require('fs');
    const { size } = statSync(vsixPath!);
    const sizeMB = size / (1024 * 1024);
    assert.ok(
      sizeMB < 50,
      `VSIX is ${sizeMB.toFixed(1)} MB — unexpectedly large, check for accidental inclusions`,
    );
  });
});
