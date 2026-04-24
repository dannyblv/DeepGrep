use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value, token_budget: usize) -> Result<(String, usize)> {
    let symbol = args["symbol"].as_str().ok_or_else(|| anyhow::anyhow!("symbol required"))?;
    let file_hint = args["file_path"].as_str();

    let nodes = queries::search_nodes(&db.conn, symbol, 20)?;
    let start = if let Some(hint) = file_hint {
        nodes.iter().find(|n| n["file"].as_str().unwrap_or("").contains(hint))
            .or_else(|| nodes.first())
    } else {
        nodes.first()
    };

    let start = match start {
        Some(n) => n.clone(),
        None => return Ok((format!("Symbol \"{}\" not found in index.", symbol), 0)),
    };

    let start_id = start["id"].as_str().unwrap_or("");
    let cap = (token_budget / 20).max(10).min(50);
    let dep_ids = queries::get_dep_chain(&db.conn, start_id, cap)?;

    let shown = dep_ids.len();
    let mut out = format!(
        "## Dependency chain for `{}` ({} deps, cap {})\n\n",
        symbol, shown, cap
    );

    for id in &dep_ids {
        if let Ok(Some(node)) = queries::get_node(&db.conn, id) {
            out.push_str(&format!(
                "- `{}` ({}) {}\n",
                node["name"].as_str().unwrap_or("?"),
                node["type"].as_str().unwrap_or("?"),
                node["file"].as_str().unwrap_or("?"),
            ));
        } else {
            out.push_str(&format!("- `{}` (unresolved)\n", id));
        }
    }

    if shown == 0 {
        out.push_str("_No dependencies found._\n");
    }

    Ok((out, shown + 1))
}
