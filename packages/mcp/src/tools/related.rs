use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<(String, usize)> {
    let hops = args["hops"].as_u64().unwrap_or(2).clamp(1, 5) as usize;
    let max_nodes = args["max_nodes"].as_u64().unwrap_or(60).clamp(1, 200) as usize;

    let start_id = resolve_start_id(db, args)?;

    let banner = queries::staleness_banner(&db.conn).unwrap_or_default();

    let start_id = match start_id {
        Some(id) => id,
        None => return Ok((format!("{}Provide `symbol` or `file_path`.", banner), 0)),
    };

    let related = queries::get_neighbourhood_ordered(&db.conn, &start_id, hops)?;
    let total = related.len();
    let capped = related.len().min(max_nodes);

    let label = if let Some(node) = queries::get_node(&db.conn, &start_id)? {
        format!(
            "`{}` ({})",
            node["name"].as_str().unwrap_or("?"),
            node["type"].as_str().unwrap_or("?"),
        )
    } else {
        format!("`{}`", start_id)
    };

    let mut out = format!(
        "{}## Related nodes for {} — {} found within {} hop(s)\n\n",
        banner, label, total, hops
    );

    let mut current_hop = 0usize;
    for (id, hop) in related.iter().take(capped) {
        if *hop != current_hop {
            current_hop = *hop;
            out.push_str(&format!("\n### Hop {}\n\n", hop));
        }
        if let Ok(Some(node)) = queries::get_node(&db.conn, id) {
            let name = node["name"].as_str().unwrap_or("?");
            let kind = node["type"].as_str().unwrap_or("?");
            let file = node["file"].as_str().unwrap_or("?");
            let start = node["start_line"].as_i64().unwrap_or(0);
            let end = node["end_line"].as_i64().unwrap_or(0);

            if *hop == 1 {
                out.push_str(&format!("#### `{}` ({}) — {}:{}-{}\n", name, kind, file, start, end));
                let snippet = node["snippet"].as_str().unwrap_or("").trim();
                if !snippet.is_empty() {
                    out.push_str(&format!("```\n{}\n```\n\n", &snippet[..snippet.len().min(300)]));
                } else {
                    out.push('\n');
                }
            } else {
                out.push_str(&format!(
                    "- `{}` ({}) {}:{}\n",
                    name, kind, file, start,
                ));
            }
        }
    }

    if total > capped {
        out.push_str(&format!("\n… and {} more (increase `max_nodes` to see them)\n", total - capped));
    }

    Ok((out, capped + 1))
}

fn resolve_start_id(db: &Db, args: &Value) -> Result<Option<String>> {
    if let Some(symbol) = args["symbol"].as_str() {
        let nodes = queries::search_nodes(&db.conn, symbol, 5)?;
        return Ok(nodes.into_iter().next().and_then(|n| n["id"].as_str().map(|s| s.to_string())));
    }

    if let Some(file) = args["file_path"].as_str() {
        // First try direct file_path match (handles full relative paths)
        if let Some(id) = queries::get_file_node_id(&db.conn, file)? {
            return Ok(Some(id));
        }
        // Fall back to FTS name search (handles bare filename like "GraphDatabase.ts")
        let nodes = queries::search_nodes(&db.conn, file, 10)?;
        return Ok(nodes
            .into_iter()
            .find(|n| n["type"].as_str() == Some("file"))
            .and_then(|n| n["id"].as_str().map(|s| s.to_string())));
    }

    Ok(None)
}
