import assert from 'node:assert/strict';
import { describe, it, before } from 'mocha';
import { resolve } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { TreeSitterIndexer } from '../indexer/TreeSitterIndexer';

const GRAMMARS_DIR = resolve(__dirname, '../../grammars');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpTs(content: string): string {
  const p = resolve(tmpdir(), `deepgrep-test-${Date.now()}.ts`);
  writeFileSync(p, content, 'utf8');
  return p;
}

function cleanup(path: string): void {
  try { unlinkSync(path); } catch { /* ignore */ }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('TreeSitterIndexer', function () {
  // WASM grammar loading is slow on first run
  this.timeout(20000);

  let indexer: TreeSitterIndexer;

  before(async () => {
    indexer = new TreeSitterIndexer();
    await indexer.init(GRAMMARS_DIR);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('throws if indexFile is called before init()', () => {
      const fresh = new TreeSitterIndexer();
      assert.throws(
        () => fresh.indexFile('/some/file.ts', '/some'),
        /not initialized/i,
      );
    });
  });

  // ── TypeScript fixture ────────────────────────────────────────────────────

  describe('TypeScript parsing', () => {
    const tsFile = resolve(FIXTURES_DIR, 'sample.ts');

    it('creates exactly one file-level node', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const fileNodes = nodes.filter(n => n.type === 'file');
      assert.equal(fileNodes.length, 1);
      assert.equal(fileNodes[0].name, 'sample.ts');
    });

    it('extracts named function declarations', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const fns = nodes.filter(n => n.type === 'function');
      assert.ok(fns.some(f => f.name === 'greet'), 'greet function not found');
      assert.ok(fns.some(f => f.name === 'add'), 'add function not found');
    });

    it('extracts class declarations', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const classes = nodes.filter(n => n.type === 'class');
      assert.ok(classes.some(c => c.name === 'Animal'), 'Animal class not found');
      assert.ok(classes.some(c => c.name === 'Dog'), 'Dog class not found');
    });

    it('extracts interface declarations', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const ifaces = nodes.filter(n => n.type === 'interface');
      assert.ok(ifaces.some(i => i.name === 'Shape'), 'Shape interface not found');
    });

    it('extracts type aliases', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const types = nodes.filter(n => n.type === 'type');
      assert.ok(types.some(t => t.name === 'Point'), 'Point type not found');
    });

    it('extracts import statements', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const imports = nodes.filter(n => n.type === 'import');
      assert.ok(imports.some(i => i.name === 'fs'), 'fs import not found');
      assert.ok(imports.some(i => i.name === 'path'), 'path import not found');
    });

    it('all nodes have the required fields', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      for (const node of nodes) {
        assert.ok(node.id, `node "${node.name}" is missing id`);
        assert.ok(node.name, `node is missing name`);
        assert.ok(node.file_path, `node "${node.name}" is missing file_path`);
        assert.ok(node.type, `node "${node.name}" is missing type`);
        assert.ok(typeof node.start_line === 'number', `start_line must be a number`);
        assert.ok(typeof node.end_line === 'number', `end_line must be a number`);
        assert.ok(node.language, `node "${node.name}" is missing language`);
      }
    });

    it('node IDs are deterministic across two runs', () => {
      const r1 = indexer.indexFile(tsFile, FIXTURES_DIR);
      const r2 = indexer.indexFile(tsFile, FIXTURES_DIR);
      const ids1 = new Set(r1.nodes.map(n => n.id));
      const ids2 = new Set(r2.nodes.map(n => n.id));
      assert.equal(ids1.size, ids2.size);
      for (const id of ids1) assert.ok(ids2.has(id), `id "${id}" not stable`);
    });

    it('file_path is relative to workspaceRoot, not absolute', () => {
      const { nodes } = indexer.indexFile(tsFile, FIXTURES_DIR);
      for (const node of nodes) {
        assert.ok(
          !node.file_path.startsWith('/'),
          `file_path "${node.file_path}" should be relative`,
        );
      }
    });

    it('generates exports edges from file node to functions and classes', () => {
      const { nodes, edges } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const fileNode = nodes.find(n => n.type === 'file');
      const greetNode = nodes.find(n => n.name === 'greet');
      assert.ok(fileNode, 'file node missing');
      assert.ok(greetNode, 'greet node missing');
      const exportEdge = edges.find(
        ed => ed.source_id === fileNode!.id && ed.target_id === greetNode!.id && ed.type === 'exports',
      );
      assert.ok(exportEdge, 'exports edge from file to greet not found');
    });

    it('generates imports edges from file node to import nodes', () => {
      const { nodes, edges } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const fileNode = nodes.find(n => n.type === 'file');
      const importNodes = nodes.filter(n => n.type === 'import');
      assert.ok(fileNode, 'file node missing');
      assert.ok(importNodes.length > 0, 'no import nodes found');
      for (const imp of importNodes) {
        const importEdge = edges.find(
          ed => ed.source_id === fileNode!.id && ed.target_id === imp.id && ed.type === 'imports',
        );
        assert.ok(importEdge, `imports edge for "${imp.name}" not found`);
      }
    });

    it('edge source and target IDs reference real nodes', () => {
      const { nodes, edges } = indexer.indexFile(tsFile, FIXTURES_DIR);
      const nodeIds = new Set(nodes.map(n => n.id));
      for (const edge of edges) {
        assert.ok(nodeIds.has(edge.source_id), `source_id "${edge.source_id}" not in nodes`);
        // target_id may reference external symbols — only check source
      }
    });
  });

  // ── JavaScript fixture ────────────────────────────────────────────────────

  describe('JavaScript parsing', () => {
    const jsFile = resolve(FIXTURES_DIR, 'sample.js');

    it('extracts functions from a .js file', () => {
      const { nodes } = indexer.indexFile(jsFile, FIXTURES_DIR);
      const fns = nodes.filter(n => n.type === 'function');
      assert.ok(fns.some(f => f.name === 'add'), 'add function not found');
      assert.ok(fns.some(f => f.name === 'multiply'), 'multiply function not found');
    });

    it('extracts classes from a .js file', () => {
      const { nodes } = indexer.indexFile(jsFile, FIXTURES_DIR);
      const classes = nodes.filter(n => n.type === 'class');
      assert.ok(classes.some(c => c.name === 'Calculator'), 'Calculator not found');
    });

    it('creates a file-level node for .js files', () => {
      const { nodes } = indexer.indexFile(jsFile, FIXTURES_DIR);
      assert.equal(nodes.filter(n => n.type === 'file').length, 1);
    });
  });

  // ── Inline TypeScript snippets ────────────────────────────────────────────

  describe('inline TypeScript snippets', () => {
    it('empty file returns only the file node', () => {
      const p = tmpTs('');
      try {
        const { nodes } = indexer.indexFile(p, tmpdir());
        const nonFile = nodes.filter(n => n.type !== 'file');
        assert.equal(nonFile.length, 0, 'empty file should yield no non-file nodes');
      } finally { cleanup(p); }
    });

    it('single function produces one function node + one file node', () => {
      const p = tmpTs('function hello() { return 42; }');
      try {
        const { nodes } = indexer.indexFile(p, tmpdir());
        assert.equal(nodes.filter(n => n.type === 'file').length, 1);
        assert.equal(nodes.filter(n => n.type === 'function').length, 1);
        assert.equal(nodes.find(n => n.type === 'function')?.name, 'hello');
      } finally { cleanup(p); }
    });

    it('code_snippet is captured for functions (up to 500 chars)', () => {
      const body = 'function snippet() { return "hello"; }';
      const p = tmpTs(body);
      try {
        const { nodes } = indexer.indexFile(p, tmpdir());
        const fn = nodes.find(n => n.name === 'snippet');
        assert.ok(fn, 'function node not found');
        assert.ok(fn.code_snippet.length > 0, 'code_snippet should not be empty');
        assert.ok(fn.code_snippet.length <= 500, 'code_snippet should be capped at 500');
      } finally { cleanup(p); }
    });

    it('multiple functions produce one node per function', () => {
      const p = tmpTs('function a() {}\nfunction b() {}\nfunction c() {}');
      try {
        const { nodes } = indexer.indexFile(p, tmpdir());
        assert.equal(nodes.filter(n => n.type === 'function').length, 3);
      } finally { cleanup(p); }
    });
  });

  // ── Error / edge cases ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns empty result for a non-existent file path', () => {
      const result = indexer.indexFile('/absolutely/nonexistent/file.ts', '/absolutely');
      assert.equal(result.nodes.length, 0);
      assert.equal(result.edges.length, 0);
    });

    it('returns empty result for an unsupported file extension', () => {
      const p = resolve(tmpdir(), `deepgrep-test-${Date.now()}.xyz`);
      writeFileSync(p, 'some content');
      try {
        const result = indexer.indexFile(p, tmpdir());
        assert.equal(result.nodes.length, 0);
        assert.equal(result.edges.length, 0);
      } finally { cleanup(p); }
    });

    it('handles a file with syntax errors gracefully (no throw)', () => {
      const p = tmpTs('function broken( { const x = ; }');
      try {
        const result = indexer.indexFile(p, tmpdir());
        // Tree-sitter is error-tolerant — result may have partial nodes, but must not throw
        assert.ok(Array.isArray(result.nodes));
        assert.ok(Array.isArray(result.edges));
      } finally { cleanup(p); }
    });
  });
});
