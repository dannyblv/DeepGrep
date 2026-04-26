use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<(String, usize)> {
    let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 50) as usize;
    let kind_filter = args["kind"].as_str();

    let rows = queries::search_content(&db.conn, query, limit)?;

    let filtered: Vec<&Value> = match kind_filter {
        Some(k) => rows.iter().filter(|r| r["kind"].as_str() == Some(k)).collect(),
        None => rows.iter().collect(),
    };

    if filtered.is_empty() {
        return Ok((
            format!(
                "No content matches for \"{}\"\n\n\
                 **Coverage note**: content_fts indexes string literals and comments. \
                 For symbol names use `search_graph`. Run **Re-index Workspace** if \
                 results seem missing.",
                query
            ),
            0,
        ));
    }

    let mut out = format!("Found {} content match(es) for \"{}\":\n\n", filtered.len(), query);
    for m in &filtered {
        out.push_str(&format!(
            "- **{}:{}** ({}) `{}`\n",
            m["file"].as_str().unwrap_or("?"),
            m["line"].as_i64().unwrap_or(0),
            m["kind"].as_str().unwrap_or("?"),
            m["content"].as_str().unwrap_or(""),
        ));
    }
    Ok((out, 0))
}
