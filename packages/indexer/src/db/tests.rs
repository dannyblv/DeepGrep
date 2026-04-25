use rusqlite::Connection;
use serde_json::json;

use crate::db::schema::SCHEMA_SQL;
use crate::protocol::{EdgeType, GraphEdge, GraphNode, NodeType};
use super::writer;

fn open_mem() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(SCHEMA_SQL).unwrap();
    conn
}

fn make_node(id: &str, name: &str, file: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        node_type: NodeType::Function,
        name: name.to_string(),
        file_path: file.to_string(),
        start_line: 1,
        end_line: 10,
        language: "typescript".to_string(),
        code_snippet: format!("function {}() {{}}", name),
        node_hash: "deadbeef".to_string(),
        metadata: json!({}),
    }
}

fn make_edge(src: &str, tgt: &str) -> GraphEdge {
    GraphEdge {
        source_id: src.to_string(),
        target_id: tgt.to_string(),
        edge_type: EdgeType::Calls,
    }
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn upsert_nodes_inserts_row() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[make_node("n:a", "foo", "src/a.ts")]).unwrap();
    assert_eq!(count(&conn, "nodes"), 1);
}

#[test]
fn upsert_nodes_replace_on_duplicate_id() {
    let conn = open_mem();
    let mut node = make_node("n:a", "foo", "src/a.ts");
    writer::upsert_nodes(&conn, &[node.clone()]).unwrap();
    node.code_snippet = "function foo_updated() {}".to_string();
    writer::upsert_nodes(&conn, &[node]).unwrap();
    // Still one row — INSERT OR REPLACE replaced it
    assert_eq!(count(&conn, "nodes"), 1);
    let snippet: String = conn
        .query_row("SELECT code_snippet FROM nodes WHERE id = 'n:a'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(snippet, "function foo_updated() {}");
}

#[test]
fn upsert_edges_inserts_when_both_nodes_exist() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[
        make_node("n:a", "foo", "src/a.ts"),
        make_node("n:b", "bar", "src/b.ts"),
    ]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:b")]).unwrap();
    assert_eq!(count(&conn, "edges"), 1);
}

#[test]
fn upsert_edges_drops_when_source_missing() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[make_node("n:b", "bar", "src/b.ts")]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:ghost", "n:b")]).unwrap();
    assert_eq!(count(&conn, "edges"), 0);
}

#[test]
fn upsert_edges_drops_when_target_missing() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[make_node("n:a", "foo", "src/a.ts")]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:ghost")]).unwrap();
    assert_eq!(count(&conn, "edges"), 0);
}

#[test]
fn upsert_edges_idempotent() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[
        make_node("n:a", "foo", "src/a.ts"),
        make_node("n:b", "bar", "src/b.ts"),
    ]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:b")]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:b")]).unwrap();
    assert_eq!(count(&conn, "edges"), 1, "duplicate edge should be ignored");
}

#[test]
fn clear_all_removes_all_nodes_and_edges() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[
        make_node("n:a", "foo", "src/a.ts"),
        make_node("n:b", "bar", "src/b.ts"),
    ]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:b")]).unwrap();
    writer::clear_all(&conn).unwrap();
    assert_eq!(count(&conn, "nodes"), 0);
    assert_eq!(count(&conn, "edges"), 0);
}

#[test]
fn delete_file_removes_its_nodes_and_edges() {
    let conn = open_mem();
    writer::upsert_nodes(&conn, &[
        make_node("n:a", "foo", "src/a.ts"),
        make_node("n:b", "bar", "src/b.ts"),
    ]).unwrap();
    writer::upsert_edges(&conn, &[make_edge("n:a", "n:b")]).unwrap();
    writer::delete_file(&conn, "src/a.ts").unwrap();
    // node from a.ts deleted, b.ts survives
    assert_eq!(count(&conn, "nodes"), 1);
    // edge where a.ts was source should be deleted
    assert_eq!(count(&conn, "edges"), 0);
}

#[test]
fn metadata_json_round_trips() {
    let conn = open_mem();
    let mut node = make_node("n:a", "foo", "src/a.ts");
    node.metadata = json!({"async": true, "returnType": "void"});
    writer::upsert_nodes(&conn, &[node]).unwrap();
    let raw: String = conn
        .query_row("SELECT metadata FROM nodes WHERE id = 'n:a'", [], |r| r.get(0))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["async"], json!(true));
    assert_eq!(parsed["returnType"], json!("void"));
}
