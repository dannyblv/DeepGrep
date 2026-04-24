use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<String> {
    let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
    let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 50) as usize;

    let nodes = queries::search_nodes(&db.conn, query, limit)?;

    if nodes.is_empty() {
        return Ok(format!("No nodes found matching \"{}\"", query));
    }

    let mut out = format!("Found {} node(s) matching \"{}\":\n\n", nodes.len(), query);
    for n in &nodes {
        out.push_str(&format!(
            "- **{}** `{}` ({}) {}:{}\n",
            n["name"].as_str().unwrap_or("?"),
            n["type"].as_str().unwrap_or("?"),
            n["file"].as_str().unwrap_or("?"),
            n["start_line"].as_i64().unwrap_or(0),
            n["end_line"].as_i64().unwrap_or(0),
        ));
    }
    Ok(out)
}
