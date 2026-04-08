use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let db_path = data_dir.join("data.db");
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        // Enable WAL mode
        conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;

        // Run migrations
        Self::migrate(&conn)?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    fn migrate(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'text',
                source_app TEXT NOT NULL DEFAULT 'Unknown',
                source_url TEXT,
                source_title TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                char_count INTEGER NOT NULL DEFAULT 0,
                is_archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_items_is_archived ON items(is_archived);
            CREATE INDEX IF NOT EXISTS idx_items_source_app ON items(source_app);

            CREATE TABLE IF NOT EXISTS tags (
                name TEXT PRIMARY KEY,
                use_count INTEGER NOT NULL DEFAULT 1,
                last_used_at TEXT NOT NULL,
                color_index INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_tags_use_count ON tags(use_count DESC);

            CREATE TABLE IF NOT EXISTS packs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                constraints_text TEXT,
                questions TEXT,
                item_ids TEXT NOT NULL DEFAULT '[]',
                export_format TEXT NOT NULL DEFAULT 'markdown',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "
        ).map_err(|e| e.to_string())?;

        // Create FTS5 table if not exists
        let fts_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='items_fts'",
            [],
            |row| row.get(0),
        ).unwrap_or(false);

        if !fts_exists {
            conn.execute_batch(
                "
                CREATE VIRTUAL TABLE items_fts USING fts5(
                    content,
                    source_app,
                    source_title,
                    tags,
                    content='items',
                    content_rowid='rowid'
                );

                CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
                    INSERT INTO items_fts(rowid, content, source_app, source_title, tags)
                    VALUES (new.rowid, new.content, new.source_app, new.source_title, new.tags);
                END;

                CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
                    INSERT INTO items_fts(items_fts, rowid, content, source_app, source_title, tags)
                    VALUES ('delete', old.rowid, old.content, old.source_app, old.source_title, old.tags);
                END;

                CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
                    INSERT INTO items_fts(items_fts, rowid, content, source_app, source_title, tags)
                    VALUES ('delete', old.rowid, old.content, old.source_app, old.source_title, old.tags);
                    INSERT INTO items_fts(rowid, content, source_app, source_title, tags)
                    VALUES (new.rowid, new.content, new.source_app, new.source_title, new.tags);
                END;
                "
            ).map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}
