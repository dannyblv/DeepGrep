import esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  // better-sqlite3 is a native module — keep it external and copy the .node file
  external: ['vscode', 'better-sqlite3'],
  // web-tree-sitter ships WASM — mark it so esbuild doesn't try to bundle the binary
  loader: { '.wasm': 'file' },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching...');
} else {
  await esbuild.build(options);
  console.log('Build complete');
}
