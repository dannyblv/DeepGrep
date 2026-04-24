mod db;
mod indexer;
mod protocol;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use clap::{Parser, Subcommand};
use db::writer;

#[derive(Parser)]
#[command(name = "deepgrep-indexer", about = "DeepGrep AST indexer (Rust/native tree-sitter)")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Index an entire workspace into the graph DB
    Index {
        #[arg(long, help = "Workspace root directory")]
        workspace: PathBuf,
        #[arg(long, help = "SQLite DB path (.deepgrep/graph.db)")]
        db: PathBuf,
    },
    /// Re-index a single file (incremental update)
    Reindex {
        #[arg(help = "Absolute path to the file")]
        file: PathBuf,
        #[arg(long)]
        workspace: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Index { workspace, db } => cmd_index(&workspace, &db),
        Command::Reindex { file, workspace, db } => cmd_reindex(&file, &workspace, &db),
    }
}

fn cmd_index(workspace: &PathBuf, db_path: &PathBuf) -> Result<()> {
    let start = Instant::now();
    let db = db::Database::open(db_path)?;

    let grammars = Arc::new(indexer::Grammars::load());
    let files = indexer::walker::discover_files(workspace, &[]);
    let total = files.len();
    eprintln!("indexing: {} files", total);

    let result = indexer::index_workspace(&files, workspace, grammars)?;

    let t_parse = start.elapsed().as_millis();
    eprintln!("parsed: {}ms — {} nodes, {} edges", t_parse, result.nodes.len(), result.edges.len());

    // Atomic DB write inside a single transaction
    let conn = &db.conn;
    conn.execute_batch("BEGIN")?;
    writer::clear_all(conn)?;
    writer::upsert_nodes(conn, &result.nodes)?;
    writer::upsert_edges(conn, &result.edges)?;
    if db.fts_ready {
        writer::rebuild_fts(conn)?;
    }
    conn.execute_batch("COMMIT")?;

    let duration = start.elapsed().as_millis();
    db.set_meta("last_indexed", &chrono_now())?;
    db.set_meta("last_index_duration_ms", &duration.to_string())?;

    // Output JSON summary for the extension to read
    println!(
        "{{\"nodes\":{},\"edges\":{},\"files\":{},\"duration_ms\":{}}}",
        result.nodes.len(),
        result.edges.len(),
        total,
        duration,
    );
    Ok(())
}

fn cmd_reindex(file: &PathBuf, workspace: &PathBuf, db_path: &PathBuf) -> Result<()> {
    let start = Instant::now();
    let db = db::Database::open(db_path)?;

    let grammars = indexer::Grammars::load();
    let rel_path = file
        .strip_prefix(workspace)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| file.to_string_lossy().into_owned());

    let conn = &db.conn;

    // Find changed nodes to mark memories stale
    let old_hashes = fetch_node_hashes(conn, &rel_path);

    conn.execute_batch("BEGIN")?;
    writer::delete_file(conn, &rel_path)?;

    let changed_ids = if let Some(result) = indexer::parse_file(file, workspace, &grammars) {
        let changed: Vec<String> = result
            .nodes
            .iter()
            .filter(|n| {
                old_hashes
                    .get(&n.id)
                    .map(|old| old != &n.node_hash)
                    .unwrap_or(false)
            })
            .map(|n| n.id.clone())
            .collect();

        writer::upsert_nodes(conn, &result.nodes)?;
        writer::upsert_edges(conn, &result.edges)?;
        if db.fts_ready {
            writer::update_fts_for_file(conn, &rel_path)?;
        }
        changed
    } else {
        vec![]
    };

    if !changed_ids.is_empty() {
        writer::mark_stale_memories(conn, &changed_ids)?;
    }
    conn.execute_batch("COMMIT")?;

    let duration = start.elapsed().as_millis();
    println!("{{\"file\":{:?},\"duration_ms\":{}}}", rel_path, duration);
    Ok(())
}

fn fetch_node_hashes(conn: &rusqlite::Connection, rel_path: &str) -> std::collections::HashMap<String, String> {
    conn.prepare("SELECT id, node_hash FROM nodes WHERE file_path = ?")
        .ok()
        .map(|mut stmt| {
            stmt.query_map([rel_path], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        })
        .unwrap_or_default()
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
