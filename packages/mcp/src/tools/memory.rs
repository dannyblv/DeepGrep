use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn get(db: &Db, args: &Value) -> Result<String> {
    let agent_id = args["agent_id"].as_str().ok_or_else(|| anyhow::anyhow!("agent_id required"))?;
    let key = args["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?;

    match queries::get_memory(&db.conn, agent_id, key)? {
        None => Ok(format!("No memory found for agent `{}` key `{}`.", agent_id, key)),
        Some(entry) => {
            let value = entry["value"].as_str().unwrap_or("");
            let stale = entry["stale"].as_bool().unwrap_or(false);
            let flag = if stale { " **[STALE — code changed]**" } else { "" };
            Ok(format!("{}{}", value, flag))
        }
    }
}

pub fn set(db: &Db, args: &Value) -> Result<String> {
    let agent_id = args["agent_id"].as_str().ok_or_else(|| anyhow::anyhow!("agent_id required"))?;
    let key = args["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?;
    let value = args["value"].as_str().ok_or_else(|| anyhow::anyhow!("value required"))?;
    let node_id = args["node_id"].as_str();

    queries::set_memory(&db.conn, agent_id, key, value, node_id)?;
    let binding = format!(" (bound to `{}`)", node_id.unwrap_or(""));
    let bound_info = if node_id.is_some() { binding.as_str() } else { "" };
    Ok(format!("Memory saved: `{}` → `{}`{}.", key, value, bound_info))
}
