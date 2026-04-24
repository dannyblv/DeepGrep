use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value, token_budget: usize) -> Result<String> {
    let symbol = args["symbol"].as_str().ok_or_else(|| anyhow::anyhow!("symbol required"))?;
    let file_hint = args["file_path"].as_str();

    // Prefer exact match in hinted file, then first fuzzy hit
    let nodes = queries::search_nodes(&db.conn, symbol, 20)?;
    let node = if let Some(hint) = file_hint {
        nodes.iter().find(|n| n["file"].as_str().unwrap_or("").contains(hint))
            .or_else(|| nodes.first())
    } else {
        nodes.first()
    };

    let node = match node {
        Some(n) => n.clone(),
        None => return Ok(format!("Symbol \"{}\" not found in index.", symbol)),
    };

    let id = node["id"].as_str().unwrap_or("");
    let callers = queries::get_incoming(&db.conn, id)?;
    let callees = queries::get_outgoing(&db.conn, id)?;

    // Check for stale memories bound to this node
    let stale_memories = stale_for_node(&db.conn, id);

    let snippet = node["snippet"].as_str().unwrap_or("");
    let capped_snippet = &snippet[..snippet.len().min(token_budget * 4)];

    let mut out = format!(
        "## `{}` ({}) — {}:{}\n\n",
        node["name"].as_str().unwrap_or("?"),
        node["type"].as_str().unwrap_or("?"),
        node["file"].as_str().unwrap_or("?"),
        node["start_line"].as_i64().unwrap_or(0),
    );

    if !capped_snippet.is_empty() {
        out.push_str("### Source\n```\n");
        out.push_str(capped_snippet);
        out.push_str("\n```\n\n");
    }

    if !stale_memories.is_empty() {
        out.push_str("### ⚠ Stale Memories\n");
        for (key, val) in &stale_memories {
            out.push_str(&format!("- `{}`: {} **[STALE — code changed]**\n", key, val));
        }
        out.push('\n');
    }

    if !callers.is_empty() {
        out.push_str(&format!("### Callers ({})\n", callers.len()));
        for e in callers.iter().take(10) {
            out.push_str(&format!("- `{}`\n", e["source"].as_str().unwrap_or("?")));
        }
        if callers.len() > 10 {
            out.push_str(&format!("… and {} more\n", callers.len() - 10));
        }
        out.push('\n');
    }

    if !callees.is_empty() {
        out.push_str(&format!("### Callees ({})\n", callees.len()));
        for e in callees.iter().take(10) {
            out.push_str(&format!("- `{}` ({})\n", e["target"].as_str().unwrap_or("?"), e["type"].as_str().unwrap_or("?")));
        }
        if callees.len() > 10 {
            out.push_str(&format!("… and {} more\n", callees.len() - 10));
        }
    }

    Ok(out)
}

fn stale_for_node(conn: &rusqlite::Connection, node_id: &str) -> Vec<(String, String)> {
    conn.prepare(
        "SELECT key, value FROM agent_memory WHERE node_id = ? AND stale_at IS NOT NULL",
    )
    .ok()
    .map(|mut stmt| {
        stmt.query_map([node_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    })
    .unwrap_or_default()
}
