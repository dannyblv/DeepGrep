pub mod queries;

use anyhow::Result;
use rusqlite::{Connection, OpenFlags};

pub struct Db {
    pub conn: Connection,
}

impl Db {
    pub fn open_read_only(path: &str) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA cache_size = -32000;")?;
        Ok(Self { conn })
    }
}
