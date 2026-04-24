use anyhow::Result;

use crate::db::{queries, Db};

pub fn run(db: &Db) -> Result<String> {
    let stats = queries::get_stats(&db.conn)?;

    Ok(format!(
        "## DeepGrep Index Stats\n\
         - **Nodes**: {}\n\
         - **Edges**: {}\n\
         - **Schema version**: {}\n\
         - **Last indexed**: {}\n\
         - **Index duration**: {}ms\n",
        stats["node_count"],
        stats["edge_count"],
        stats["schema_version"].as_str().unwrap_or("?"),
        stats["last_indexed_relative"].as_str().unwrap_or("never"),
        stats["last_index_duration_ms"].as_str().unwrap_or("?"),
    ))
}
