use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

// ── Node search ───────────────────────────────────────────────────────────────

pub fn search_nodes(conn: &Connection, query: &str, limit: usize) -> Result<Vec<Value>> {
    // Try FTS5 trigram search first, fall back to LIKE
    let fts_result = conn.prepare(
        "SELECT n.id, n.name, n.type, n.file_path, n.start_line, n.end_line, n.code_snippet, n.node_hash
         FROM nodes_fts JOIN nodes n ON n.id = nodes_fts.id
         WHERE nodes_fts MATCH ?
           AND nodes_fts.file_path NOT LIKE '.next/%'
         ORDER BY length(n.name)
         LIMIT ?",
    ).and_then(|mut stmt| {
        let phrase = format!("\"{}\"", query.replace('"', "\"\""));
        let rows: Vec<Value> = stmt
            .query_map(rusqlite::params![phrase, limit as i64], row_to_node)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    });

    match fts_result {
        Ok(rows) if !rows.is_empty() => return Ok(rows),
        _ => {}
    }

    // LIKE fallback
    let mut stmt = conn.prepare(
        "SELECT id, name, type, file_path, start_line, end_line, code_snippet, node_hash
         FROM nodes
         WHERE name LIKE ? AND file_path NOT LIKE '.next/%'
         ORDER BY length(name) LIMIT ?",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![format!("%{}%", query), limit as i64], row_to_node)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn row_to_node(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(serde_json::json!({
        "id":        row.get::<_, String>(0)?,
        "name":      row.get::<_, String>(1)?,
        "type":      row.get::<_, String>(2)?,
        "file":      row.get::<_, String>(3)?,
        "start_line": row.get::<_, i64>(4)?,
        "end_line":  row.get::<_, i64>(5)?,
        "snippet":   row.get::<_, String>(6)?,
        "node_hash": row.get::<_, String>(7)?,
    }))
}

// ── Node by ID ────────────────────────────────────────────────────────────────

pub fn get_node(conn: &Connection, id: &str) -> Result<Option<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, type, file_path, start_line, end_line, code_snippet, metadata, node_hash
         FROM nodes WHERE id = ?",
    )?;
    let row = stmt
        .query_row([id], |row| {
            Ok(serde_json::json!({
                "id":        row.get::<_, String>(0)?,
                "name":      row.get::<_, String>(1)?,
                "type":      row.get::<_, String>(2)?,
                "file":      row.get::<_, String>(3)?,
                "start_line": row.get::<_, i64>(4)?,
                "end_line":  row.get::<_, i64>(5)?,
                "snippet":   row.get::<_, String>(6)?,
                "metadata":  row.get::<_, String>(7)?,
                "node_hash": row.get::<_, String>(8)?,
            }))
        })
        .optional()?;
    Ok(row)
}

// ── Edges ─────────────────────────────────────────────────────────────────────

pub fn get_outgoing(conn: &Connection, node_id: &str) -> Result<Vec<Value>> {
    get_edges(conn, "SELECT source_id, target_id, type FROM edges WHERE source_id = ?", node_id)
}

pub fn get_incoming(conn: &Connection, node_id: &str) -> Result<Vec<Value>> {
    get_edges(conn, "SELECT source_id, target_id, type FROM edges WHERE target_id = ?", node_id)
}

fn get_edges(conn: &Connection, sql: &str, id: &str) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(serde_json::json!({
                "source": r.get::<_, String>(0)?,
                "target": r.get::<_, String>(1)?,
                "type":   r.get::<_, String>(2)?,
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ── Node by file path ─────────────────────────────────────────────────────────

pub fn get_file_node_id(conn: &Connection, file_path: &str) -> Result<Option<String>> {
    let row = conn
        .query_row(
            "SELECT id FROM nodes WHERE file_path = ? AND type = 'file' LIMIT 1",
            [file_path],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(row)
}

// ── BFS neighbourhood ─────────────────────────────────────────────────────────

#[allow(dead_code)]
pub fn get_neighbourhood(conn: &Connection, start_id: &str, max_hops: usize) -> Result<Vec<String>> {
    let ordered = get_neighbourhood_ordered(conn, start_id, max_hops)?;
    Ok(ordered.into_iter().map(|(id, _)| id).collect())
}

/// Returns (node_id, hop_distance) pairs in BFS order (closest first).
pub fn get_neighbourhood_ordered(
    conn: &Connection,
    start_id: &str,
    max_hops: usize,
) -> Result<Vec<(String, usize)>> {
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited.insert(start_id.to_string());
    let mut frontier = vec![start_id.to_string()];
    let mut result: Vec<(String, usize)> = Vec::new();

    for hop in 1..=max_hops {
        if frontier.is_empty() {
            break;
        }
        let placeholders = frontier.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let out_sql = format!("SELECT target_id FROM edges WHERE source_id IN ({})", placeholders);
        let in_sql = format!("SELECT source_id FROM edges WHERE target_id IN ({})", placeholders);

        let mut new_frontier: Vec<String> = Vec::new();
        for sql in &[out_sql, in_sql] {
            let mut stmt = conn.prepare(sql)?;
            let params: Vec<&dyn rusqlite::ToSql> =
                frontier.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let ids: Vec<String> = stmt
                .query_map(params.as_slice(), |r| r.get(0))?
                .filter_map(|r| r.ok())
                .collect();
            for id in ids {
                if visited.insert(id.clone()) {
                    result.push((id.clone(), hop));
                    new_frontier.push(id);
                }
            }
        }

        frontier = new_frontier;
    }

    Ok(result)
}

// ── Dependency chain (DFS, callee direction) ─────────────────────────────────

pub fn get_dep_chain(conn: &Connection, start_id: &str, cap: usize) -> Result<Vec<String>> {
    let mut visited = std::collections::HashSet::new();
    let mut stack = vec![start_id.to_string()];
    let mut stmt = conn.prepare("SELECT target_id FROM edges WHERE source_id = ?")?;

    while let Some(id) = stack.pop() {
        if visited.len() >= cap || visited.contains(&id) {
            continue;
        }
        visited.insert(id.clone());
        let deps: Vec<String> = stmt
            .query_map([&id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        stack.extend(deps);
    }

    visited.remove(start_id);
    Ok(visited.into_iter().collect())
}

// ── Content FTS (string literals + comments) ──────────────────────────────────

pub fn search_content(conn: &Connection, query: &str, limit: usize) -> Result<Vec<Value>> {
    let phrase = format!("\"{}\"", query.replace('"', "\"\""));
    let result = conn
        .prepare(
            "SELECT file_path, line, kind, content
             FROM content_fts
             WHERE content MATCH ?
             LIMIT ?",
        )
        .and_then(|mut stmt| {
            let rows: Vec<Value> = stmt
                .query_map(rusqlite::params![phrase, limit as i64], |row| {
                    Ok(serde_json::json!({
                        "file":    row.get::<_, String>(0)?,
                        "line":    row.get::<_, i64>(1)?,
                        "kind":    row.get::<_, String>(2)?,
                        "content": row.get::<_, String>(3)?,
                    }))
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        });
    Ok(result.unwrap_or_default())
}

// ── Agent memory ──────────────────────────────────────────────────────────────

pub fn get_memory(conn: &Connection, agent_id: &str, key: &str) -> Result<Option<Value>> {
    let row = conn
        .query_row(
            "SELECT value, stale_at FROM agent_memory WHERE agent_id = ? AND key = ?",
            [agent_id, key],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .optional()?;

    Ok(row.map(|(value, stale_at)| {
        let stale = stale_at.is_some();
        serde_json::json!({"value": value, "stale": stale})
    }))
}

pub fn set_memory(
    conn: &Connection,
    agent_id: &str,
    key: &str,
    value: &str,
    node_id: Option<&str>,
) -> Result<()> {
    let id = format!("{}:{}", agent_id, key);
    let now = now_ms();
    conn.execute(
        "INSERT OR REPLACE INTO agent_memory (id, agent_id, node_id, key, value, created_at, stale_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)",
        rusqlite::params![id, agent_id, node_id, key, value, now],
    )?;
    Ok(())
}

// ── Stats ─────────────────────────────────────────────────────────────────────

pub fn get_stats(conn: &Connection) -> Result<Value> {
    let node_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?;
    let edge_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))?;

    let last_indexed: Option<String> = conn
        .query_row(
            "SELECT value FROM index_metadata WHERE key = 'last_indexed'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let duration_ms: Option<String> = conn
        .query_row(
            "SELECT value FROM index_metadata WHERE key = 'last_index_duration_ms'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let schema_version: Option<String> = conn
        .query_row(
            "SELECT value FROM index_metadata WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let skipped_files: Option<String> = conn
        .query_row(
            "SELECT value FROM index_metadata WHERE key = 'skipped_files'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    Ok(serde_json::json!({
        "node_count":             node_count,
        "edge_count":             edge_count,
        "last_indexed":           last_indexed,
        "last_index_duration_ms": duration_ms,
        "schema_version":         schema_version.unwrap_or_else(|| "1".into()),
        "last_indexed_relative":  last_indexed.as_deref().map(format_relative).unwrap_or("never".into()),
        "skipped_files":          skipped_files.as_deref().unwrap_or("0"),
    }))
}

/// Returns a Markdown warning line if the index is more than 2 minutes stale.
/// Prepend this to any tool output so users know to re-index before trusting results.
pub fn staleness_banner(conn: &Connection) -> Option<String> {
    let ts_str: String = conn
        .query_row(
            "SELECT value FROM index_metadata WHERE key = 'last_indexed'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()?;
    let ts: u64 = ts_str.parse().ok()?;
    let now = now_ms() as u64;
    let secs = now.saturating_sub(ts) / 1000;
    if secs <= 120 {
        return None;
    }
    let (val, unit) = if secs < 3600 { (secs / 60, "m") } else { (secs / 3600, "h") };
    Some(format!(
        "> ⚠ Index is {}{}+ stale — edits since last index are invisible. Run **Re-index Workspace** for accurate results.\n\n",
        val, unit
    ))
}

fn format_relative(ts_str: &str) -> String {
    let ts: u64 = ts_str.parse().unwrap_or(0);
    let now = now_ms() as u64;
    let secs = now.saturating_sub(ts) / 1000;
    if secs < 60 {
        format!("{}s ago", secs)
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else {
        format!("{}h ago", secs / 3600)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
