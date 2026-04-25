use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<(String, usize)> {
    let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
    let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 50) as usize;

    let nodes = queries::search_nodes(&db.conn, query, limit)?;

    let banner = queries::staleness_banner(&db.conn).unwrap_or_default();

    if nodes.is_empty() {
        return Ok((format!(
            "{}No nodes found matching \"{}\"\n\n\
             **Coverage note**: the index tracks defined names — functions, classes, interfaces, \
             and import specifiers. It does not cover string literals, comments, JSX prop values, \
             or config keys. If you expected a match, confirm with grep before concluding the \
             symbol doesn't exist.",
            banner, query
        ), 0));
    }

    let served = nodes.len();
    let mut out = format!("{}Found {} node(s) matching \"{}\":\n\n", banner, served, query);
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
    Ok((out, served))
}
