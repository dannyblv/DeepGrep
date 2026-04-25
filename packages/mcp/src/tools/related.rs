use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<(String, usize)> {
    let hops = args["hops"].as_u64().unwrap_or(2).clamp(1, 5) as usize;

    let start_id = if let Some(symbol) = args["symbol"].as_str() {
        let nodes = queries::search_nodes(&db.conn, symbol, 5)?;
        nodes.into_iter().next().and_then(|n| n["id"].as_str().map(|s| s.to_string()))
    } else if let Some(file) = args["file_path"].as_str() {
        // Find the file node
        queries::search_nodes(&db.conn, file, 5)?
            .into_iter()
            .find(|n| n["type"].as_str() == Some("file"))
            .and_then(|n| n["id"].as_str().map(|s| s.to_string()))
    } else {
        None
    };

    let banner = queries::staleness_banner(&db.conn).unwrap_or_default();

    let start_id = match start_id {
        Some(id) => id,
        None => return Ok((format!("{}Provide `symbol` or `file_path`.", banner), 0)),
    };

    let related_ids = queries::get_neighbourhood(&db.conn, &start_id, hops)?;
    let total = related_ids.len();
    let served = total.min(30) + 1;

    let mut out = format!("{}## Related nodes ({} within {} hop(s))\n\n", banner, total, hops);
    for id in related_ids.iter().take(30) {
        if let Ok(Some(node)) = queries::get_node(&db.conn, id) {
            out.push_str(&format!(
                "- `{}` ({}) {}\n",
                node["name"].as_str().unwrap_or("?"),
                node["type"].as_str().unwrap_or("?"),
                node["file"].as_str().unwrap_or("?"),
            ));
        }
    }
    if total > 30 {
        out.push_str(&format!("… and {} more\n", total - 30));
    }
    Ok((out, served))
}
