pub mod schema;
pub mod writer;

#[cfg(test)]
mod tests;

use anyhow::Result;
use rusqlite::Connection;
use schema::{FTS_SQL, MIGRATIONS_V3, SCHEMA_SQL, SCHEMA_VERSION};

pub struct Database {
    pub conn: Connection,
    pub fts_ready: bool,
}

impl Database {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA cache_size = -32000;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        let fts_ready = conn.execute_batch(FTS_SQL).is_ok();
        Self::migrate(&conn)?;
        Ok(Self { conn, fts_ready })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        let current: i64 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM index_metadata WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if current < 3 {
            for sql in MIGRATIONS_V3 {
                // Ignore "duplicate column" errors from repeated migrations
                let _ = conn.execute_batch(sql);
            }
        }

        conn.execute(
            "INSERT OR REPLACE INTO index_metadata (key, value) VALUES ('schema_version', ?)",
            [SCHEMA_VERSION],
        )?;
        Ok(())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)",
            [key, value],
        )?;
        Ok(())
    }
}
