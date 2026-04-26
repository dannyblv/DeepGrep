use anyhow::Result;
use rusqlite::Connection;

use crate::protocol::{ContentLine, EdgeType, GraphEdge, GraphNode, NodeType};

fn node_type_str(t: &NodeType) -> &'static str {
    match t {
        NodeType::File => "file",
        NodeType::Function => "function",
        NodeType::Class => "class",
        NodeType::Variable => "variable",
        NodeType::Import => "import",
        NodeType::Interface => "interface",
        NodeType::TypeAlias => "type",
    }
}

fn edge_type_str(t: &EdgeType) -> &'static str {
    match t {
        EdgeType::Calls => "calls",
        EdgeType::Imports => "imports",
        EdgeType::Extends => "extends",
        EdgeType::Uses => "uses",
        EdgeType::Exports => "exports",
        EdgeType::ReExports => "re-exports",
    }
}

pub fn clear_all(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM edges; DELETE FROM nodes;")?;
    let _ = conn.execute("DELETE FROM nodes_fts", []);
    let _ = conn.execute("DELETE FROM content_fts", []);
    Ok(())
}

pub fn delete_file(conn: &Connection, rel_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)
              OR target_id IN (SELECT id FROM nodes WHERE file_path = ?)",
        [rel_path, rel_path],
    )?;
    conn.execute("DELETE FROM nodes WHERE file_path = ?", [rel_path])?;
    let _ = conn.execute("DELETE FROM content_fts WHERE file_path = ?", [rel_path]);
    Ok(())
}

pub fn upsert_content_lines(conn: &Connection, lines: &[ContentLine]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO content_fts (file_path, line, kind, content) VALUES (?, ?, ?, ?)",
    )?;
    for l in lines {
        stmt.execute(rusqlite::params![l.file_path, l.line as i64, l.kind, l.content])?;
    }
    Ok(())
}

pub fn update_content_for_file(conn: &Connection, rel_path: &str, lines: &[ContentLine]) -> Result<()> {
    let _ = conn.execute("DELETE FROM content_fts WHERE file_path = ?", [rel_path]);
    upsert_content_lines(conn, lines)
}

pub fn upsert_nodes(conn: &Connection, nodes: &[GraphNode]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO nodes
         (id, type, name, file_path, start_line, end_line, language, code_snippet, node_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for n in nodes {
        stmt.execute(rusqlite::params![
            n.id,
            node_type_str(&n.node_type),
            n.name,
            n.file_path,
            n.start_line as i64,
            n.end_line as i64,
            n.language,
            n.code_snippet,
            n.node_hash,
            serde_json::to_string(&n.metadata).unwrap_or_else(|_| "{}".into()),
        ])?;
    }
    Ok(())
}

pub fn upsert_edges(conn: &Connection, edges: &[GraphEdge]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR IGNORE INTO edges (source_id, target_id, type)
         SELECT ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM nodes WHERE id = ?)
           AND EXISTS (SELECT 1 FROM nodes WHERE id = ?)",
    )?;
    for e in edges {
        stmt.execute(rusqlite::params![
            e.source_id,
            e.target_id,
            edge_type_str(&e.edge_type),
            e.source_id,
            e.target_id,
        ])?;
    }
    Ok(())
}

/// Rebuild the FTS5 search index from the current nodes table.
pub fn rebuild_fts(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM nodes_fts")?;
    conn.execute_batch(
        "INSERT INTO nodes_fts(id, name, type, file_path)
         SELECT id, name, type, file_path FROM nodes",
    )?;
    Ok(())
}

/// Incremental FTS update after a single-file re-index.
pub fn update_fts_for_file(conn: &Connection, rel_path: &str) -> Result<()> {
    conn.execute("DELETE FROM nodes_fts WHERE file_path = ?", [rel_path])?;
    conn.execute_batch(&format!(
        "INSERT INTO nodes_fts(id, name, type, file_path)
         SELECT id, name, type, file_path FROM nodes WHERE file_path = '{}'",
        rel_path.replace('\'', "''")
    ))?;
    Ok(())
}

/// Mark agent memories stale for nodes whose hash changed.
pub fn mark_stale_memories(conn: &Connection, changed_node_ids: &[String]) -> Result<()> {
    if changed_node_ids.is_empty() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let mut stmt = conn.prepare_cached(
        "UPDATE agent_memory SET stale_at = ? WHERE node_id = ? AND stale_at IS NULL",
    )?;
    for id in changed_node_ids {
        stmt.execute(rusqlite::params![now, id])?;
    }
    Ok(())
}
