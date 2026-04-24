import esbuild from 'esbuild';
import { argv } from 'process';
import { createRequire } from 'module';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const watch = argv.includes('--watch');
const req = createRequire(import.meta.url);

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  // better-sqlite3 and web-tree-sitter are kept external so they load from node_modules
  // at runtime, where their own path resolution for .node and .wasm files works correctly.
  // Bundling web-tree-sitter breaks import.meta.url inside the emscripten WASM loader.
  external: ['vscode', 'better-sqlite3', 'web-tree-sitter'],
};

// MCP stdio server — bundled as ESM so top-level await and node:sqlite work.
// Output: dist/mcp-server.js  (the path weboo.co.il/.mcp.json points to)
// MCP stdio server — bundled as CJS so it loads cleanly via `node dist/mcp-server.js`.
// esbuild wraps top-level await in an async IIFE when targeting CJS.
// node:sqlite and other Node builtins remain external automatically.
/** @type {import('esbuild').BuildOptions} */
const mcpOptions = {
  entryPoints: ['../mcp-server/src/index.ts'],
  bundle: true,
  outfile: 'dist/mcp-server.js',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: !watch,
  // shebang already present in packages/mcp-server/src/index.ts line 1
};

function copyAssets() {
  mkdirSync('dist', { recursive: true });
  // web-tree-sitter resolves tree-sitter.wasm relative to the bundled file's dir (dist/)
  const webTreeSitterDir = dirname(req.resolve('web-tree-sitter'));
  copyFileSync(join(webTreeSitterDir, 'tree-sitter.wasm'), 'dist/tree-sitter.wasm');
}

if (watch) {
  copyAssets();
  const [ctx] = await Promise.all([
    esbuild.context({
      ...options,
      plugins: [{ name: 'copy-assets', setup(build) { build.onEnd(copyAssets); } }],
    }),
    esbuild.context(mcpOptions),
  ]);
  await ctx.watch();
  console.log('Watching...');
} else {
  await Promise.all([
    esbuild.build(options),
    esbuild.build(mcpOptions),
  ]);
  copyAssets();
  console.log('Build complete');
}
