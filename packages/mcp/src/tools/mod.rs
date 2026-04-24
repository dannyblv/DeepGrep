pub mod context;
pub mod deps;
pub mod memory;
pub mod related;
pub mod search;
pub mod stats;

use anyhow::Result;
use serde_json::Value;

use crate::db::Db;

pub fn dispatch(db: &Db, tool_name: &str, args: &Value, token_budget: usize) -> Result<String> {
    match tool_name {
        "search_graph" => search::run(db, args),
        "get_context_for_symbol" => context::run(db, args, token_budget),
        "get_dependency_chain" => deps::run(db, args, token_budget),
        "find_related_nodes" => related::run(db, args),
        "get_agent_memory" => memory::get(db, args),
        "set_agent_memory" => memory::set(db, args),
        "get_stats" => stats::run(db),
        _ => Err(anyhow::anyhow!("unknown tool: {}", tool_name)),
    }
}
