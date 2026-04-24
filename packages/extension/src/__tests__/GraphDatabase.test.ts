import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { GraphDatabase } from '../db/GraphDatabase';
import type { GraphNode, GraphEdge } from '../db/GraphDatabase';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): GraphDatabase {
  return new GraphDatabase(':memory:');
}

function n(
  id: string,
  name: string,
  filePath = '/workspace/a.ts',
  type: GraphNode['type'] = 'function',
): GraphNode {
  return {
    id,
    name,
    type,
    file_path: filePath,
    start_line: 1,
    end_line: 10,
    language: 'typescript',
    code_snippet: `function ${name}() {}`,
    metadata: {},
  };
}

function e(
  source: string,
  target: string,
  type: GraphEdge['type'] = 'calls',
): GraphEdge {
  return { source_id: source, target_id: target, type };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GraphDatabase', () => {
  let db: GraphDatabase;

  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  // ── Nodes ──────────────────────────────────────────────────────────────────

  describe('nodes', () => {
    it('upserts and retrieves a single node', () => {
      db.upsertNode(n('a:fn:foo:1', 'foo'));
      const result = db.getNode('a:fn:foo:1');
      assert.ok(result);
      assert.equal(result.name, 'foo');
      assert.equal(result.type, 'function');
    });

    it('replaces an existing node on duplicate id', () => {
      db.upsertNode(n('id', 'foo'));
      db.upsertNode({ ...n('id', 'foo'), code_snippet: 'updated' });
      assert.equal(db.getNode('id')?.code_snippet, 'updated');
    });

    it('upsertNodes inserts multiple nodes in a single transaction', () => {
      db.upsertNodes([n('a', 'foo'), n('b', 'bar'), n('c', 'baz')]);
      assert.equal(db.getStats().node_count, 3);
    });

    it('getNode returns null for unknown id', () => {
      assert.equal(db.getNode('does:not:exist:0'), null);
    });

    it('searchNodes matches by partial name', () => {
      db.upsertNodes([
        n('a', 'handleClick'),
        n('b', 'handleBlur'),
        n('c', 'render'),
      ]);
      const results = db.searchNodes('handle');
      assert.equal(results.length, 2);
      assert.ok(results.every(r => r.name.includes('handle')));
    });

    it('searchNodes returns empty array when nothing matches', () => {
      db.upsertNodes([n('a', 'foo')]);
      assert.deepEqual(db.searchNodes('zzz'), []);
    });

    it('getNodesForFile returns only nodes belonging to that file', () => {
      db.upsertNodes([
        n('a', 'foo', '/workspace/a.ts'),
        n('b', 'bar', '/workspace/b.ts'),
      ]);
      const results = db.getNodesForFile('/workspace/a.ts');
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'foo');
    });

    it('getAllNodes returns every node', () => {
      db.upsertNodes([n('a', 'x'), n('b', 'y'), n('c', 'z')]);
      assert.equal(db.getAllNodes().length, 3);
    });

    it('deleteNodesForFile removes only that file', () => {
      db.upsertNodes([
        n('a', 'foo', '/workspace/a.ts'),
        n('b', 'bar', '/workspace/b.ts'),
      ]);
      db.deleteNodesForFile('/workspace/a.ts');
      assert.equal(db.getStats().node_count, 1);
      assert.equal(db.getAllNodes()[0].name, 'bar');
    });

    it('metadata object is round-tripped via JSON', () => {
      const meta = { async: true, returnType: 'void', tags: ['exported'] };
      db.upsertNode({ ...n('a', 'foo'), metadata: meta });
      assert.deepEqual(db.getNode('a')?.metadata, meta);
    });
  });

  // ── Edges ──────────────────────────────────────────────────────────────────

  describe('edges', () => {
    const SRC = 'a:fn:foo:1';
    const TGT = 'a:fn:bar:5';

    beforeEach(() => {
      db.upsertNodes([n(SRC, 'foo'), n(TGT, 'bar')]);
    });

    it('upsertEdge inserts when both endpoints exist', () => {
      db.upsertEdge(e(SRC, TGT));
      assert.equal(db.getStats().edge_count, 1);
    });

    it('duplicate edge is silently ignored (idempotent)', () => {
      db.upsertEdge(e(SRC, TGT));
      db.upsertEdge(e(SRC, TGT));
      assert.equal(db.getStats().edge_count, 1);
    });

    it('getOutgoing returns edges leaving a node', () => {
      db.upsertEdge(e(SRC, TGT));
      const edges = db.getOutgoing(SRC);
      assert.equal(edges.length, 1);
      assert.equal(edges[0].target_id, TGT);
    });

    it('getIncoming returns edges arriving at a node', () => {
      db.upsertEdge(e(SRC, TGT));
      const edges = db.getIncoming(TGT);
      assert.equal(edges.length, 1);
      assert.equal(edges[0].source_id, SRC);
    });

    it('getAllEdges returns all edges', () => {
      db.upsertEdge(e(SRC, TGT, 'calls'));
      db.upsertEdge(e(TGT, SRC, 'uses'));
      assert.equal(db.getAllEdges().length, 2);
    });

    // ── FK constraint handling (critical — the bug that was fixed) ──────────

    it('FK violation: edge with missing source is silently dropped', () => {
      db.upsertEdges([e('ghost:fn:missing:0', TGT)]);
      assert.equal(db.getStats().edge_count, 0);
    });

    it('FK violation: edge with missing target is silently dropped', () => {
      db.upsertEdges([e(SRC, 'ghost:fn:missing:0')]);
      assert.equal(db.getStats().edge_count, 0);
    });

    it('FK violation: edge with both endpoints missing is silently dropped', () => {
      db.upsertEdges([e('ghost:a', 'ghost:b')]);
      assert.equal(db.getStats().edge_count, 0);
    });

    it('upsertEdges: valid and invalid edges are mixed — only valid land', () => {
      db.upsertEdges([
        e(SRC, TGT),                      // valid
        e('ghost:fn:x:0', TGT),           // missing source
        e(SRC, 'ghost:fn:y:0'),           // missing target
        e('ghost:fn:p:0', 'ghost:fn:q:0'),// both missing
      ]);
      assert.equal(db.getStats().edge_count, 1);
    });

    it('deleteEdgesForFile removes edges where file nodes are source', () => {
      db.upsertEdge(e(SRC, TGT));
      db.deleteEdgesForFile('/workspace/a.ts');
      assert.equal(db.getStats().edge_count, 0);
    });

    it('deleteEdgesForFile removes edges where file nodes are target', () => {
      db.upsertEdge(e(TGT, SRC));
      db.deleteEdgesForFile('/workspace/a.ts'); // SRC is in a.ts
      assert.equal(db.getStats().edge_count, 0);
    });
  });

  // ── Two-pass cross-file edge pattern ──────────────────────────────────────

  describe('two-pass indexing (cross-file edges)', () => {
    it('edges land when both files are indexed before edges are inserted', () => {
      // Simulates reindexWorkspace pass-1 (all nodes) then pass-2 (all edges)
      db.upsertNodes([
        n('a:fn:caller:1', 'caller', '/workspace/a.ts'),
        n('b:fn:callee:1', 'callee', '/workspace/b.ts'),
      ]);
      db.upsertEdges([e('a:fn:caller:1', 'b:fn:callee:1')]);
      assert.equal(db.getStats().edge_count, 1);
    });

    it('cross-file edges are silently dropped when target file not yet indexed', () => {
      // Simulates (broken) single-pass: file A indexed before file B
      db.upsertNodes([n('a:fn:caller:1', 'caller', '/workspace/a.ts')]);
      db.upsertEdges([e('a:fn:caller:1', 'b:fn:callee:1')]); // b not indexed yet
      // Now index file B — but it's too late, edge was already dropped
      db.upsertNodes([n('b:fn:callee:1', 'callee', '/workspace/b.ts')]);
      assert.equal(db.getStats().edge_count, 0);
    });
  });

  // ── Cascade deletes ────────────────────────────────────────────────────────

  describe('cascade deletes', () => {
    it('deleting a file removes its outgoing edges', () => {
      db.upsertNodes([
        n('a:fn:foo:1', 'foo', '/workspace/a.ts'),
        n('b:fn:bar:1', 'bar', '/workspace/b.ts'),
      ]);
      db.upsertEdge(e('a:fn:foo:1', 'b:fn:bar:1'));
      db.deleteEdgesForFile('/workspace/a.ts');
      assert.equal(db.getStats().edge_count, 0);
      // b's node should still exist
      assert.equal(db.getStats().node_count, 2);
    });
  });

  // ── Graph traversal ────────────────────────────────────────────────────────

  describe('getNeighbourhood', () => {
    // Graph: A → B → C, A → D, E (disconnected)
    beforeEach(() => {
      db.upsertNodes(['A', 'B', 'C', 'D', 'E'].map(name => n(`n:${name}`, name)));
      db.upsertEdges([
        e('n:A', 'n:B'),
        e('n:B', 'n:C'),
        e('n:A', 'n:D'),
      ]);
    });

    it('depth=1 returns only direct neighbours', () => {
      const result = new Set(db.getNeighbourhood('n:A', 1));
      assert.ok(result.has('n:B'));
      assert.ok(result.has('n:D'));
      assert.ok(!result.has('n:C'), 'C is 2 hops away');
    });

    it('depth=2 reaches transitive neighbours', () => {
      const result = db.getNeighbourhood('n:A', 2);
      assert.ok(result.includes('n:C'), 'C reachable via A→B→C');
    });

    it('start node is not included in the result', () => {
      const result = db.getNeighbourhood('n:A', 3);
      assert.ok(!result.includes('n:A'));
    });

    it('disconnected nodes are never included', () => {
      const result = db.getNeighbourhood('n:A', 3);
      assert.ok(!result.includes('n:E'));
    });

    it('returns empty array for isolated node', () => {
      assert.deepEqual(db.getNeighbourhood('n:E', 2), []);
    });
  });

  describe('getDependencyChain', () => {
    it('returns transitive callees in chain', () => {
      db.upsertNodes(['A', 'B', 'C'].map(name => n(`n:${name}`, name)));
      db.upsertEdges([e('n:A', 'n:B'), e('n:B', 'n:C')]);
      const chain = db.getDependencyChain('n:A');
      assert.ok(chain.includes('n:B'));
      assert.ok(chain.includes('n:C'));
      assert.ok(!chain.includes('n:A'));
    });

    it('handles cycles without hanging', () => {
      db.upsertNodes([n('n:A', 'A'), n('n:B', 'B')]);
      db.upsertEdges([e('n:A', 'n:B'), e('n:B', 'n:A')]);
      const chain = db.getDependencyChain('n:A');
      assert.ok(Array.isArray(chain));
      assert.ok(chain.length <= 50); // capped at 50
    });

    it('returns empty for a leaf node with no outgoing edges', () => {
      db.upsertNodes([n('n:A', 'A')]);
      assert.deepEqual(db.getDependencyChain('n:A'), []);
    });
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zero counts on fresh DB', () => {
      const s = db.getStats();
      assert.equal(s.node_count, 0);
      assert.equal(s.edge_count, 0);
      assert.equal(s.last_indexed, null);
      assert.equal(s.last_index_duration_ms, null);
    });

    it('counts reflect inserts and deletes', () => {
      db.upsertNodes([
        n('a', 'foo', '/workspace/a.ts'),
        n('b', 'bar', '/workspace/b.ts'),
      ]);
      db.upsertEdge(e('a', 'b'));
      assert.equal(db.getStats().node_count, 2);
      assert.equal(db.getStats().edge_count, 1);
      db.deleteNodesForFile('/workspace/a.ts');
      assert.equal(db.getStats().node_count, 1);
    });

    it('last_indexed and duration are returned as numbers', () => {
      const ts = Date.now();
      db.setMeta('last_indexed', String(ts));
      db.setMeta('last_index_duration_ms', '1234');
      const s = db.getStats();
      assert.equal(s.last_indexed, ts);
      assert.equal(s.last_index_duration_ms, 1234);
    });

    it('schema_version is set to "1"', () => {
      assert.equal(db.getStats().schema_version, '1');
    });
  });

  // ── Agent memory ───────────────────────────────────────────────────────────

  describe('agent memory', () => {
    it('sets and gets a value', () => {
      db.setAgentMemory('indexer', 'last_file', '/workspace/a.ts');
      assert.equal(db.getAgentMemory('indexer', 'last_file'), '/workspace/a.ts');
    });

    it('overwrites an existing value', () => {
      db.setAgentMemory('indexer', 'count', '1');
      db.setAgentMemory('indexer', 'count', '42');
      assert.equal(db.getAgentMemory('indexer', 'count'), '42');
    });

    it('returns null for unknown key', () => {
      assert.equal(db.getAgentMemory('indexer', 'nonexistent'), null);
    });

    it('different agents are fully isolated', () => {
      db.setAgentMemory('indexer', 'key', 'indexer-value');
      db.setAgentMemory('graph-analyst', 'key', 'analyst-value');
      assert.equal(db.getAgentMemory('indexer', 'key'), 'indexer-value');
      assert.equal(db.getAgentMemory('graph-analyst', 'key'), 'analyst-value');
    });

    it('listAgentMemory returns only entries for that agent', () => {
      db.setAgentMemory('indexer', 'a', '1');
      db.setAgentMemory('indexer', 'b', '2');
      db.setAgentMemory('other-agent', 'c', '3');
      const entries = db.listAgentMemory('indexer');
      assert.equal(entries.length, 2);
      assert.ok(entries.every(e => e.agent_id === 'indexer'));
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('setMeta / getMeta', () => {
    it('stores and retrieves a string value', () => {
      db.setMeta('my_key', 'my_value');
      assert.equal(db.getMeta('my_key'), 'my_value');
    });

    it('returns null for unknown key', () => {
      assert.equal(db.getMeta('nonexistent'), null);
    });

    it('overwrites an existing meta entry', () => {
      db.setMeta('k', 'v1');
      db.setMeta('k', 'v2');
      assert.equal(db.getMeta('k'), 'v2');
    });
  });
});
