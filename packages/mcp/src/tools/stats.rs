use anyhow::Result;

use crate::db::{queries, Db};

pub fn run(db: &Db) -> Result<String> {
    let stats = queries::get_stats(&db.conn)?;

    let skipped = stats["skipped_files"].as_str().unwrap_or("0");
    let skipped_note = if skipped != "0" {
        format!(
            "- **Skipped files**: {} (too large >1 MB, unsupported extension, or parse error — these files are invisible to symbol search)\n",
            skipped
        )
    } else {
        String::new()
    };

    Ok(format!(
        "## ⬡ DeepGrep Index Stats\n\
         - **Nodes**: {}\n\
         - **Edges**: {}\n\
         - **Schema version**: {}\n\
         - **Last indexed**: {}\n\
         - **Index duration**: {}ms\n\
         {}\
         \n\
         **Coverage note**: Index tracks function/class/interface/import names. \
         String literals, comments, JSX prop values, and config keys are not indexed — use rg for those.\n",
        stats["node_count"],
        stats["edge_count"],
        stats["schema_version"].as_str().unwrap_or("?"),
        stats["last_indexed_relative"].as_str().unwrap_or("never"),
        stats["last_index_duration_ms"].as_str().unwrap_or("?"),
        skipped_note,
    ))
}
