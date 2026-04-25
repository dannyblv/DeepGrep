//! Integration tests for the MCP tool dispatcher.
//!
//! The primary invariant under test is the `served` count — the number of
//! nodes each tool reports as having returned to the caller. The extension
//! host multiplies this by ~200 tokens/node to compute the Prompt Impact
//! metrics shown in the webview sidebar, so if any tool under-reports
//! `served`, the sidebar silently stays at zero.

use rusqlite::Connection;
use serde_json::json;

use super::dispatch;
use crate::db::Db;

/// Build an in-memory SQLite DB with the DeepGrep schema and a tiny fixture
/// graph: file F1 containing functions A, B, C, where A calls B and B calls C.
fn fixture() -> Db {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            file_path TEXT,
            start_line INTEGER,
            end_line INTEGER,
            code_snippet TEXT,
            metadata TEXT,
            node_hash TEXT
        );
        CREATE TABLE edges (
            source_id TEXT,
            target_id TEXT,
            type TEXT,
            PRIMARY KEY (source_id, target_id, type)
        );
        CREATE TABLE agent_memory (
            id TEXT PRIMARY KEY,
            agent_id TEXT,
            node_id TEXT,
            key TEXT,
            value TEXT,
            created_at INTEGER,
            stale_at INTEGER
        );
        CREATE TABLE index_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        INSERT INTO nodes VALUES
            ('n:F1',  'F1.ts',  'file',     'src/F1.ts', 1,  50, '',              '{}', 'h0'),
            ('n:A',   'alpha',  'function', 'src/F1.ts', 2,  10, 'fn alpha(){}',  '{}', 'h1'),
            ('n:B',   'beta',   'function', 'src/F1.ts', 12, 20, 'fn beta(){}',   '{}', 'h2'),
            ('n:C',   'gamma',  'function', 'src/F1.ts', 22, 30, 'fn gamma(){}',  '{}', 'h3'),
            ('n:D',   'delta',  'function', 'src/F2.ts', 1,  10, 'fn delta(){}',  '{}', 'h4');
        INSERT INTO edges VALUES
            ('n:A', 'n:B', 'calls'),
            ('n:B', 'n:C', 'calls'),
            ('n:D', 'n:A', 'calls');
        INSERT INTO index_metadata VALUES
            ('schema_version', '1'),
            ('last_indexed', '1000'),
            ('last_index_duration_ms', '42');
        "#,
    )
    .unwrap();
    Db { conn }
}

#[test]
fn search_graph_served_equals_match_count() {
    let db = fixture();
    let (_text, served) = dispatch(&db, "search_graph", &json!({"query": "alpha"}), 4000).unwrap();
    assert_eq!(served, 1, "search_graph should report one match for 'alpha'");
}

#[test]
fn search_graph_served_is_zero_on_miss() {
    let db = fixture();
    let (text, served) =
        dispatch(&db, "search_graph", &json!({"query": "no_such_symbol"}), 4000).unwrap();
    assert_eq!(served, 0);
    assert!(text.contains("No nodes found"), "expected miss message, got: {}", text);
    assert!(
        text.contains("Coverage note"),
        "miss message should include coverage caveat, got: {}",
        text
    );
}

#[test]
fn search_graph_miss_includes_grep_suggestion() {
    let db = fixture();
    let (text, _) =
        dispatch(&db, "search_graph", &json!({"query": "definitely_absent"}), 4000).unwrap();
    assert!(text.contains("grep"), "miss message should recommend grep, got: {}", text);
}

#[test]
fn stale_index_prepends_banner_to_search_results() {
    // fixture sets last_indexed = '1000' (epoch ms 1970 ≈ now - decades) → always stale
    let db = fixture();
    let (text, _) = dispatch(&db, "search_graph", &json!({"query": "alpha"}), 4000).unwrap();
    assert!(
        text.contains("stale"),
        "stale index should prepend warning banner, got: {}",
        text
    );
}

#[test]
fn stale_index_banner_appears_in_context_tool() {
    let db = fixture();
    let (text, _) = dispatch(&db, "get_context_for_symbol", &json!({"symbol": "beta"}), 4000).unwrap();
    assert!(text.contains("stale"), "context tool should show staleness banner, got: {}", text);
}

#[test]
fn get_stats_shows_coverage_note() {
    let db = fixture();
    let (text, _) = dispatch(&db, "get_stats", &json!({}), 4000).unwrap();
    assert!(text.contains("Coverage note"), "stats should include coverage note, got: {}", text);
}

#[test]
fn get_context_for_symbol_served_counts_node_plus_callers_and_callees() {
    // `beta` has caller `alpha` and callee `gamma` → 1 + 1 + 1 = 3
    let db = fixture();
    let (_text, served) =
        dispatch(&db, "get_context_for_symbol", &json!({"symbol": "beta"}), 4000).unwrap();
    assert_eq!(served, 3);
}

#[test]
fn get_context_for_symbol_miss_serves_zero() {
    let db = fixture();
    let (_text, served) =
        dispatch(&db, "get_context_for_symbol", &json!({"symbol": "zzzz"}), 4000).unwrap();
    assert_eq!(served, 0);
}

#[test]
fn get_dependency_chain_served_includes_start_node() {
    // alpha → beta → gamma ⇒ 2 deps + 1 start = 3
    let db = fixture();
    let (_text, served) =
        dispatch(&db, "get_dependency_chain", &json!({"symbol": "alpha"}), 4000).unwrap();
    assert_eq!(served, 3);
}

#[test]
fn find_related_nodes_served_nonzero_within_graph() {
    let db = fixture();
    let (_text, served) = dispatch(
        &db,
        "find_related_nodes",
        &json!({"symbol": "beta", "hops": 1}),
        4000,
    )
    .unwrap();
    // beta has direct neighbours alpha and gamma (2) + 1 start = 3
    assert_eq!(served, 3);
}

#[test]
fn get_stats_reports_zero_served() {
    let db = fixture();
    let (text, served) = dispatch(&db, "get_stats", &json!({}), 4000).unwrap();
    assert_eq!(served, 0, "get_stats is metadata-only, shouldn't inflate token savings");
    assert!(text.contains("Nodes"), "stats text should reference node counts");
}

#[test]
fn memory_tools_report_zero_served() {
    let db = fixture();
    let (_t1, s1) = dispatch(
        &db,
        "get_agent_memory",
        &json!({"agent_id": "x", "key": "y"}),
        4000,
    )
    .unwrap();
    assert_eq!(s1, 0);

    let (_t2, s2) = dispatch(
        &db,
        "set_agent_memory",
        &json!({"agent_id": "x", "key": "y", "value": "z"}),
        4000,
    )
    .unwrap();
    assert_eq!(s2, 0);
}
