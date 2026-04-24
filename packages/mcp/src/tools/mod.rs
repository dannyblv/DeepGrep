pub mod context;
pub mod deps;
pub mod memory;
pub mod related;
pub mod search;
pub mod stats;

#[cfg(test)]
mod tests;

use anyhow::Result;
use serde_json::Value;

use crate::db::Db;

/// Dispatch a tool call. Returns `(markdown_text, served_node_count)`.
/// `served_node_count` is the number of graph nodes returned to the caller —
/// the extension host uses it to compute prompt-impact token savings.
pub fn dispatch(db: &Db, tool_name: &str, args: &Value, token_budget: usize) -> Result<(String, usize)> {
    match tool_name {
        "search_graph" => search::run(db, args),
        "get_context_for_symbol" => context::run(db, args, token_budget),
        "get_dependency_chain" => deps::run(db, args, token_budget),
        "find_related_nodes" => related::run(db, args),
        "get_agent_memory" => memory::get(db, args).map(|t| (t, 0)),
        "set_agent_memory" => memory::set(db, args).map(|t| (t, 0)),
        "get_stats" => stats::run(db).map(|t| (t, 0)),
        _ => Err(anyhow::anyhow!("unknown tool: {}", tool_name)),
    }
}
