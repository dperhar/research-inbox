use crate::db::Database;
use crate::models::*;
use rusqlite::params;
use tauri::{Emitter, State};
use uuid::Uuid;
use chrono::Utc;
use std::process::Command;
use std::path::PathBuf;

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<CaptureItem> {
    let tags_str: String = row.get(6)?;
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
    let is_archived: i32 = row.get(8)?;
    Ok(CaptureItem {
        id: row.get(0)?,
        content: row.get(1)?,
        content_type: row.get(2)?,
        source_app: row.get(3)?,
        source_url: row.get(4)?,
        source_title: row.get(5)?,
        tags,
        char_count: row.get(7)?,
        is_archived: is_archived != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        enrichment: row.get(11)?,
    })
}

fn row_to_tag(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        name: row.get(0)?,
        use_count: row.get(1)?,
        last_used_at: row.get(2)?,
        color_index: row.get(3)?,
    })
}

fn row_to_pack(row: &rusqlite::Row) -> rusqlite::Result<ContextPack> {
    let item_ids_str: String = row.get(5)?;
    let item_ids: Vec<String> = serde_json::from_str(&item_ids_str).unwrap_or_default();
    Ok(ContextPack {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        constraints: row.get(3)?,
        questions: row.get(4)?,
        item_ids,
        export_format: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        meta: row.get(9)?,
        agent_log: row.get(10)?,
    })
}

// ── Items ──

#[tauri::command]
pub fn capture_item(
    db: State<'_, Database>,
    content: String,
    source_app: String,
    source_url: Option<String>,
    source_title: Option<String>,
    tags: Vec<String>,
) -> Result<CaptureItem, String> {

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let char_count = content.len() as i64;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO items (id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at)
         VALUES (?1, ?2, 'text', ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
        params![id, content, source_app, source_url, source_title, tags_json, char_count, now, now],
    ).map_err(|e| e.to_string())?;

    for tag in &tags {
        let color_index = tag_color_index(tag);
        conn.execute(
            "INSERT INTO tags (name, use_count, last_used_at, color_index)
             VALUES (?1, 1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET use_count = use_count + 1, last_used_at = ?2",
            params![tag, now, color_index],
        ).map_err(|e| e.to_string())?;
    }

    Ok(CaptureItem {
        id, content, content_type: "text".to_string(), source_app, source_url, source_title,
        tags, char_count, is_archived: false, created_at: now.clone(), updated_at: now,
        enrichment: None,
    })
}

#[tauri::command]
pub fn capture_screenshot(
    db: State<'_, Database>,
    tags: Vec<String>,
) -> Result<CaptureItem, String> {
    // Get data dir for storing images
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let images_dir = PathBuf::from(&home).join(".research-inbox").join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let img_id = Uuid::new_v4().to_string();
    let img_path = images_dir.join(format!("{}.png", img_id));
    let img_path_str = img_path.to_string_lossy().to_string();

    // Get foreground app BEFORE screencapture (which steals focus)
    let app_info = crate::source_detect::get_foreground_app();

    // Interactive screen region capture (macOS)
    let status = Command::new("screencapture")
        .args(["-i", &img_path_str])
        .status()
        .map_err(|e| e.to_string())?;

    if !status.success() || !img_path.exists() {
        return Err("Screenshot cancelled or failed".to_string());
    }

    // OCR the image using our compiled Swift helper
    let ocr_binary = get_ocr_binary_path();
    let ocr_text = if ocr_binary.is_empty() {
        String::new()
    } else {
        let ocr_output = Command::new(&ocr_binary)
            .arg(&img_path_str)
            .output()
            .map_err(|e| format!("OCR failed: {}. OCR binary: {}", e, ocr_binary))?;
        if ocr_output.status.success() {
            String::from_utf8_lossy(&ocr_output.stdout).trim().to_string()
        } else {
            String::new()
        }
    };

    // Build content: OCR text + reference to image
    let content = if ocr_text.is_empty() {
        format!("[Screenshot: {}]", img_path_str)
    } else {
        format!("{}\n\n[Screenshot: {}]", ocr_text, img_path_str)
    };

    // Save to DB
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let char_count = content.len() as i64;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO items (id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at)
         VALUES (?1, ?2, 'image', ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
        params![id, content, app_info.app_name, img_path_str, app_info.window_title, tags_json, char_count, now, now],
    ).map_err(|e| e.to_string())?;

    for tag in &tags {
        let ci = tag_color_index(tag);
        conn.execute(
            "INSERT INTO tags (name, use_count, last_used_at, color_index) VALUES (?1, 1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET use_count = use_count + 1, last_used_at = ?2",
            params![tag, now, ci],
        ).map_err(|e| e.to_string())?;
    }

    Ok(CaptureItem {
        id, content, content_type: "image".to_string(),
        source_app: app_info.app_name, source_url: Some(img_path_str),
        source_title: Some(app_info.window_title), tags, char_count,
        is_archived: false, created_at: now.clone(), updated_at: now,
        enrichment: None,
    })
}

#[tauri::command]
pub fn check_duplicate(
    db: State<'_, Database>,
    content: String,
) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // Check if identical content exists in last 100 items
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM (SELECT content FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 100) WHERE content = ?1",
        params![content],
        |row| row.get(0),
    ).unwrap_or(false);

    Ok(exists)
}

fn get_ocr_binary_path() -> String {
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));

    // macOS .app bundle: Contents/MacOS/../Resources/scripts/ocr
    let resources = exe_dir.parent().unwrap_or(exe_dir).join("Resources").join("scripts").join("ocr");
    if resources.exists() {
        return resources.to_string_lossy().to_string();
    }

    // Next to binary
    let beside_exe = exe_dir.join("ocr");
    if beside_exe.exists() {
        return beside_exe.to_string_lossy().to_string();
    }

    // Development: cargo manifest dir
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts").join("ocr");
    if dev_path.exists() {
        return dev_path.to_string_lossy().to_string();
    }

    String::new()
}


#[tauri::command]
pub fn list_items(
    db: State<'_, Database>,
    offset: u32,
    limit: u32,
    archived: bool,
    tag_filter: Option<String>,
    source_filter: Option<String>,
) -> Result<Vec<CaptureItem>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let archived_val: i32 = if archived { 1 } else { 0 };

    let mut sql = String::from(
        "SELECT id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at, enrichment FROM items WHERE is_archived = ?"
    );
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(archived_val)];

    if let Some(ref tag) = tag_filter {
        sql.push_str(" AND tags LIKE ?");
        params_vec.push(Box::new(format!("%\"{}\"%" , tag)));
    }
    if let Some(ref source) = source_filter {
        sql.push_str(" AND LOWER(source_app) = LOWER(?)");
        params_vec.push(Box::new(source.clone()));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
    params_vec.push(Box::new(limit));
    params_vec.push(Box::new(offset));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(param_refs.as_slice(), row_to_item).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn search_items(
    db: State<'_, Database>,
    query: String,
    limit: u32,
) -> Result<Vec<CaptureItem>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if query.trim().is_empty() {
        let mut stmt = conn.prepare(
            "SELECT id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at, enrichment FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], row_to_item).map_err(|e| e.to_string())?;
        return Ok(rows.filter_map(|r| r.ok()).collect());
    }

    // Parse special filters
    let mut fts_parts: Vec<String> = Vec::new();
    let mut extra_where: Vec<String> = Vec::new();
    let mut extra_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for part in query.split_whitespace() {
        if let Some(tag) = part.strip_prefix('#') {
            extra_where.push("i.tags LIKE ?".to_string());
            extra_params.push(Box::new(format!("%\"{}\"", tag.to_lowercase())));
        } else if let Some(source) = part.strip_prefix("from:") {
            extra_where.push("LOWER(i.source_app) = LOWER(?)".to_string());
            extra_params.push(Box::new(source.to_string()));
        } else if part == "today" {
            extra_where.push("i.created_at >= date('now', 'start of day')".to_string());
        } else if part == "this-week" {
            extra_where.push("i.created_at >= date('now', '-7 days')".to_string());
        } else {
            fts_parts.push(part.to_string());
        }
    }

    let fts_query = fts_parts.join(" ");

    // Build parameterized query: FTS param (if any), then extra filter params, then limit
    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1u32;

    let mut sql = String::from(
        "SELECT i.id, i.content, i.content_type, i.source_app, i.source_url, i.source_title, i.tags, i.char_count, i.is_archived, i.created_at, i.updated_at, i.enrichment FROM items i"
    );

    if !fts_query.is_empty() {
        sql.push_str(&format!(" JOIN items_fts ON items_fts.rowid = i.rowid AND items_fts MATCH ?{}", param_idx));
        all_params.push(Box::new(fts_query));
        param_idx += 1;
    }

    sql.push_str(" WHERE i.is_archived = 0");
    for clause in &extra_where {
        let parameterized = clause.replacen('?', &format!("?{}", param_idx), 1);
        sql.push_str(&format!(" AND {}", parameterized));
        if clause.contains('?') {
            param_idx += 1;
        }
    }
    for p in extra_params {
        all_params.push(p);
    }

    sql.push_str(&format!(" ORDER BY i.created_at DESC LIMIT ?{}", param_idx));
    all_params.push(Box::new(limit));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(param_refs.as_slice(), row_to_item).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn update_item(
    db: State<'_, Database>,
    id: String,
    content: Option<String>,
    tags: Option<Vec<String>>,
    is_archived: Option<bool>,
) -> Result<CaptureItem, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    if let Some(ref c) = content {
        conn.execute(
            "UPDATE items SET content = ?1, char_count = ?2, updated_at = ?3 WHERE id = ?4",
            params![c, c.len() as i64, now, id],
        ).map_err(|e| e.to_string())?;
    }
    if let Some(ref t) = tags {
        let tags_json = serde_json::to_string(t).unwrap_or_else(|_| "[]".to_string());
        conn.execute("UPDATE items SET tags = ?1, updated_at = ?2 WHERE id = ?3", params![tags_json, now, id])
            .map_err(|e| e.to_string())?;
        for tag in t {
            let ci = tag_color_index(tag);
            conn.execute(
                "INSERT INTO tags (name, use_count, last_used_at, color_index) VALUES (?1, 1, ?2, ?3)
                 ON CONFLICT(name) DO UPDATE SET use_count = use_count + 1, last_used_at = ?2",
                params![tag, now, ci],
            ).map_err(|e| e.to_string())?;
        }
    }
    if let Some(archived) = is_archived {
        conn.execute("UPDATE items SET is_archived = ?1, updated_at = ?2 WHERE id = ?3",
            params![if archived { 1 } else { 0 }, now, id]).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at, enrichment FROM items WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], row_to_item).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tags ──

#[tauri::command]
pub fn list_tags(
    db: State<'_, Database>,
    prefix: Option<String>,
    limit: u32,
) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let items: Vec<Tag> = if let Some(ref p) = prefix {
        let search = format!("{}%", p.to_lowercase());
        let mut stmt = conn.prepare(
            "SELECT name, use_count, last_used_at, color_index FROM tags WHERE name LIKE ?1 ORDER BY use_count DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![search, limit], row_to_tag).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT name, use_count, last_used_at, color_index FROM tags ORDER BY use_count DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], row_to_tag).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    Ok(items)
}

// ── Packs ──

#[tauri::command]
pub fn create_pack(
    db: State<'_, Database>,
    title: String,
    description: Option<String>,
    constraints: Option<String>,
    questions: Option<String>,
    item_ids: Vec<String>,
    export_format: String,
) -> Result<ContextPack, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let item_ids_json = serde_json::to_string(&item_ids).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO packs (id, title, description, constraints_text, questions, item_ids, export_format, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, title, description, constraints, questions, item_ids_json, export_format, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(ContextPack {
        id, title, description, constraints, questions, item_ids, export_format,
        created_at: now.clone(), updated_at: now,
        meta: None, agent_log: None,
    })
}

#[tauri::command]
pub fn update_pack(
    db: State<'_, Database>,
    id: String,
    title: Option<String>,
    description: Option<String>,
    constraints: Option<String>,
    questions: Option<String>,
    item_ids: Option<Vec<String>>,
    export_format: Option<String>,
) -> Result<ContextPack, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    if let Some(ref t) = title {
        conn.execute("UPDATE packs SET title = ?1, updated_at = ?2 WHERE id = ?3", params![t, now, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref d) = description {
        conn.execute("UPDATE packs SET description = ?1, updated_at = ?2 WHERE id = ?3", params![d, now, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref c) = constraints {
        conn.execute("UPDATE packs SET constraints_text = ?1, updated_at = ?2 WHERE id = ?3", params![c, now, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref q) = questions {
        conn.execute("UPDATE packs SET questions = ?1, updated_at = ?2 WHERE id = ?3", params![q, now, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref ids) = item_ids {
        let json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string());
        conn.execute("UPDATE packs SET item_ids = ?1, updated_at = ?2 WHERE id = ?3", params![json, now, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref f) = export_format {
        conn.execute("UPDATE packs SET export_format = ?1, updated_at = ?2 WHERE id = ?3", params![f, now, id]).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, title, description, constraints_text, questions, item_ids, export_format, created_at, updated_at, meta, agent_log FROM packs WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], row_to_pack).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_packs(db: State<'_, Database>, limit: u32) -> Result<Vec<ContextPack>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, description, constraints_text, questions, item_ids, export_format, created_at, updated_at, meta, agent_log FROM packs ORDER BY updated_at DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![limit], row_to_pack).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn export_pack(db: State<'_, Database>, id: String, format: String) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, title, description, constraints_text, questions, item_ids, export_format, created_at, updated_at, meta, agent_log FROM packs WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    let pack = stmt.query_row(params![id], row_to_pack).map_err(|e| e.to_string())?;

    let mut items: Vec<CaptureItem> = Vec::new();
    for item_id in &pack.item_ids {
        let mut item_stmt = conn.prepare(
            "SELECT id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at, enrichment FROM items WHERE id = ?1"
        ).map_err(|e| e.to_string())?;
        if let Ok(item) = item_stmt.query_row(params![item_id], row_to_item) {
            items.push(item);
        }
    }

    Ok(format_pack(&pack, &items, &format))
}

#[tauri::command]
pub fn delete_pack(db: State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM packs WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Settings ──

#[tauri::command]
pub fn get_settings(db: State<'_, Database>) -> Result<AppSettings, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut settings = AppSettings::default();
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        match row.0.as_str() {
            "capture_hotkey" => settings.capture_hotkey = row.1,
            "panel_hotkey" => settings.panel_hotkey = row.1,
            "quick_tag_on_capture" => settings.quick_tag_on_capture = row.1 == "true",
            "default_export_format" => settings.default_export_format = row.1,
            "max_capture_size_kb" => settings.max_capture_size_kb = row.1.parse().unwrap_or(50),
            "launch_at_login" => settings.launch_at_login = row.1 == "true",
            "theme" => settings.theme = row.1,
            "language" => settings.language = row.1,
            "data_location" => settings.data_location = row.1,
            _ => {}
        }
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(db: State<'_, Database>, settings: AppSettings) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let pairs = vec![
        ("capture_hotkey", settings.capture_hotkey),
        ("panel_hotkey", settings.panel_hotkey),
        ("quick_tag_on_capture", settings.quick_tag_on_capture.to_string()),
        ("default_export_format", settings.default_export_format),
        ("max_capture_size_kb", settings.max_capture_size_kb.to_string()),
        ("launch_at_login", settings.launch_at_login.to_string()),
        ("theme", settings.theme),
        ("language", settings.language),
        ("data_location", settings.data_location),
    ];
    for (key, value) in pairs {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── System ──

#[tauri::command]
pub fn get_foreground_app_cmd() -> Result<AppInfo, String> {
    Ok(crate::source_detect::get_foreground_app())
}

/// Check if macOS Accessibility permission is granted
#[tauri::command]
pub fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events" to keystroke ""#)
            .output();
        match output {
            Ok(o) => !String::from_utf8_lossy(&o.stderr).contains("not allowed"),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "macos"))]
    { true }
}

/// Refocus a specific app by name (used after overlay auto-dismiss)
#[tauri::command]
pub fn refocus_app(app_name: String) {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Sanitize: only allow alphanumeric, spaces, hyphens, dots (valid macOS app names)
        let safe_name: String = app_name.chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '.')
            .collect();
        if safe_name.is_empty() { return; }
        let script = format!(
            r#"tell application "{}" to activate"#,
            safe_name
        );
        let _ = Command::new("osascript").arg("-e").arg(&script).spawn();
    }
}

/// Open macOS Input Monitoring preferences pane
#[tauri::command]
pub fn open_input_monitoring_settings() {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn();
    }
}

/// Open macOS Accessibility preferences pane
#[tauri::command]
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

/// Called by overlay "Clip Text" button — detects foreground app NOW then emits event
#[tauri::command]
pub fn trigger_text_capture(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_info = crate::source_detect::get_foreground_app();
    let payload = serde_json::to_string(&app_info).unwrap_or_default();
    let result = app_handle.emit("overlay-capture-text", payload).map_err(|e: tauri::Error| e.to_string());
    result
}

/// Called by overlay "Screenshot" button — emits screenshot event
#[tauri::command]
pub fn trigger_screenshot_capture(app_handle: tauri::AppHandle) -> Result<(), String> {
    let result = app_handle.emit("overlay-capture-screenshot", ()).map_err(|e: tauri::Error| e.to_string());
    result
}

// ── AI Enrichment ──

#[tauri::command]
pub async fn enrich_item(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<serde_json::Value, String> {
    use crate::ai::pipeline;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Read item content
    let content: String = conn.query_row(
        "SELECT content FROM items WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    drop(conn); // Release lock before processing

    // Enrich
    let enrichment = pipeline::enrich_content(&content);
    let enrichment_json = serde_json::to_string(&enrichment).unwrap_or_else(|_| "{}".into());

    // Compute embedding
    let embedding = pipeline::compute_mock_embedding(&content);
    let embedding_json = serde_json::to_string(&embedding).unwrap_or_else(|_| "[]".into());

    // Write to DB
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    // Update enrichment
    conn.execute(
        "UPDATE items SET enrichment = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![enrichment_json, now, id],
    ).map_err(|e| e.to_string())?;

    // Merge auto_tags into existing tags
    let existing_tags_str: String = conn.query_row(
        "SELECT tags FROM items WHERE id = ?1", [&id], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let mut tags: Vec<String> = serde_json::from_str(&existing_tags_str).unwrap_or_default();
    for tag in &enrichment.auto_tags {
        if !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE items SET tags = ?1 WHERE id = ?2",
        rusqlite::params![tags_json, id],
    ).map_err(|e| e.to_string())?;

    // Store embedding in vec_items
    conn.execute(
        "INSERT OR REPLACE INTO vec_items (item_id, embedding) VALUES (?1, ?2)",
        rusqlite::params![id, embedding_json],
    ).map_err(|e| e.to_string())?;

    drop(conn);

    // Emit event for frontend
    let _ = app.emit("item-enriched", serde_json::json!({
        "id": id,
        "enrichment": enrichment,
        "tags": tags,
    }));

    Ok(serde_json::json!({ "ok": true }))
}

// ── Helpers ──

fn tag_color_index(tag: &str) -> i64 {
    let hash: u32 = tag.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
    (hash % 8) as i64
}

/// Format a timestamp like "2026-03-28T12:44:30.973176+00:00" into "Mar 28, 12:44"
fn fmt_time(iso: &str) -> String {
    let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if iso.len() >= 16 {
        let month_idx: usize = iso[5..7].parse().unwrap_or(1);
        let day: &str = &iso[8..10];
        let time: &str = &iso[11..16];
        let month = months.get(month_idx.wrapping_sub(1)).unwrap_or(&"???");
        format!("{} {}, {}", month, day.trim_start_matches('0'), time)
    } else {
        iso.to_string()
    }
}

/// Build a source line, omitting empty fields
fn fmt_source(app: &str, url: Option<&str>, title: Option<&str>) -> String {
    let mut parts = vec![app.to_string()];
    if let Some(u) = url { if !u.is_empty() { parts.push(u.to_string()); } }
    if let Some(t) = title { if !t.is_empty() { parts.push(t.to_string()); } }
    parts.join(" | ")
}

pub fn format_pack(pack: &ContextPack, items: &[CaptureItem], format: &str) -> String {
    let title = if pack.title.is_empty() { "Context Pack" } else { &pack.title };
    let desc = pack.description.as_deref().unwrap_or("");
    let constraints = pack.constraints.as_deref().unwrap_or("");
    let questions = pack.questions.as_deref().unwrap_or("");
    let date = if pack.created_at.len() >= 10 { &pack.created_at[..10] } else { &pack.created_at };

    match format {
        "claude" => {
            let mut out = String::from("<context>\n");
            if !title.is_empty() { out.push_str(&format!("<title>{}</title>\n", title)); }
            out.push_str(&format!("<summary>{}</summary>\n\n<evidence count=\"{}\">\n", desc, items.len()));
            for item in items {
                let mut attrs = format!("source=\"{}\" date=\"{}\"", item.source_app, fmt_time(&item.created_at));
                if let Some(ref u) = item.source_url { if !u.is_empty() { attrs.push_str(&format!(" url=\"{}\"", u)); } }
                out.push_str(&format!("<item {}>\n{}\n</item>\n", attrs, item.content));
            }
            out.push_str("</evidence>\n\n");
            out.push_str(&format!("<constraints>\n{}\n</constraints>\n\n", if constraints.is_empty() { "None specified" } else { constraints }));
            out.push_str(&format!("<questions>\n{}\n</questions>\n", if questions.is_empty() { "None specified" } else { questions }));
            out.push_str("</context>\n");
            out
        }
        "chatgpt" => {
            let mut out = format!("# Context Pack: {}\n\n", title);
            if !desc.is_empty() { out.push_str(&format!("**Summary:** {}\n\n", desc)); }
            out.push_str(&format!("**Evidence ({} items):**\n\n", items.len()));
            for (i, item) in items.iter().enumerate() {
                let source = fmt_source(&item.source_app, item.source_url.as_deref(), item.source_title.as_deref());
                out.push_str(&format!("{}. **[{}]** ({})\n   {}\n\n", i + 1, item.source_app, fmt_time(&item.created_at), item.content));
                out.push_str(&format!("   _Source: {}_\n\n", source));
            }
            out.push_str(&format!("**Constraints:** {}\n\n", if constraints.is_empty() { "None specified" } else { constraints }));
            out.push_str(&format!("**Questions:** {}\n", if questions.is_empty() { "None specified" } else { questions }));
            out
        }
        "cursor" => {
            let mut out = format!("# Project Context: {}\n\n", title);
            if !desc.is_empty() { out.push_str(&format!("## Background\n{}\n\n", desc)); }
            out.push_str(&format!("## Research Evidence ({} items)\n\n", items.len()));
            for item in items {
                let source = fmt_source(&item.source_app, item.source_url.as_deref(), item.source_title.as_deref());
                out.push_str(&format!("- **[{}]** {} ({})\n", source, item.content, fmt_time(&item.created_at)));
            }
            out.push_str(&format!("\n## Constraints\n{}\n\n## Open Questions\n{}\n",
                if constraints.is_empty() { "None specified" } else { constraints },
                if questions.is_empty() { "None specified" } else { questions }));
            out
        }
        _ => {
            // Markdown (default)
            let mut out = format!("# {}\n\n", title);
            if !desc.is_empty() { out.push_str(&format!("> {}\n\n", desc)); }
            out.push_str(&format!("## Evidence ({} items)\n\n", items.len()));
            for (i, item) in items.iter().enumerate() {
                let source = fmt_source(&item.source_app, item.source_url.as_deref(), item.source_title.as_deref());
                out.push_str(&format!("### {}. {} – {}\n", i + 1, item.source_app, fmt_time(&item.created_at)));
                out.push_str(&format!("{}\n\n", item.content));
                out.push_str(&format!("_Source: {}_\n\n", source));
            }
            out.push_str(&format!("## Constraints & Decisions\n{}\n\n", if constraints.is_empty() { "None specified" } else { constraints }));
            out.push_str(&format!("## Questions for AI\n{}\n\n", if questions.is_empty() { "None specified" } else { questions }));
            out.push_str(&format!("---\n*Context Pack by Research Inbox | {} items | {}*\n", items.len(), date));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fmt_time() {
        assert_eq!(fmt_time("2026-03-28T12:44:30.973176+00:00"), "Mar 28, 12:44");
        assert_eq!(fmt_time("2026-01-05T09:01:00Z"), "Jan 5, 09:01");
        assert_eq!(fmt_time("short"), "short");
    }

    #[test]
    fn test_fmt_source_full() {
        let s = fmt_source("Chrome", Some("https://example.com"), Some("My Page"));
        assert_eq!(s, "Chrome | https://example.com | My Page");
    }

    #[test]
    fn test_fmt_source_no_url() {
        let s = fmt_source("Telegram", None, Some("Chat with Bob"));
        assert_eq!(s, "Telegram | Chat with Bob");
    }

    #[test]
    fn test_fmt_source_empty_url() {
        let s = fmt_source("VSCode", Some(""), None);
        assert_eq!(s, "VSCode");
    }

    #[test]
    fn test_tag_color_index_range() {
        for tag in &["rust", "react", "ux", "design", "backend", "frontend"] {
            let idx = tag_color_index(tag);
            assert!(idx >= 0 && idx < 8, "Color index {} out of range for tag '{}'", idx, tag);
        }
    }

    #[test]
    fn test_format_pack_markdown() {
        let pack = ContextPack {
            id: "p1".into(), title: "Test Pack".into(), description: Some("A test".into()),
            constraints: Some("Be concise".into()), questions: Some("What is X?".into()),
            item_ids: vec!["i1".into()], export_format: "markdown".into(),
            created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            meta: None, agent_log: None,
        };
        let items = vec![CaptureItem {
            id: "i1".into(), content: "Hello world".into(), content_type: "text".into(),
            source_app: "Chrome".into(), source_url: Some("https://example.com".into()),
            source_title: Some("Example".into()), tags: vec![], char_count: 11,
            is_archived: false, created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            enrichment: None,
        }];
        let out = format_pack(&pack, &items, "markdown");
        assert!(out.contains("# Test Pack"));
        assert!(out.contains("Hello world"));
        assert!(out.contains("Be concise"));
        assert!(out.contains("What is X?"));
    }

    #[test]
    fn test_format_pack_claude_xml() {
        let pack = ContextPack {
            id: "p1".into(), title: "XML Test".into(), description: Some("desc".into()),
            constraints: None, questions: None,
            item_ids: vec![], export_format: "claude".into(),
            created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            meta: None, agent_log: None,
        };
        let out = format_pack(&pack, &[], "claude");
        assert!(out.contains("<context>"));
        assert!(out.contains("</context>"));
        assert!(out.contains("<title>XML Test</title>"));
    }

    fn make_test_db() -> Database {
        let dir = std::env::temp_dir().join(format!("ri-test-{}", uuid::Uuid::new_v4()));
        Database::new(dir).expect("test db")
    }

    #[test]
    fn test_db_init_and_insert() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at)
             VALUES (?1, ?2, 'text', ?3, NULL, NULL, '[]', ?4, 0, ?5, ?6)",
            rusqlite::params![id, "test content", "TestApp", 12i64, now, now],
        ).expect("insert");

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_fts_search() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, source_url, source_title, tags, char_count, is_archived, created_at, updated_at)
             VALUES (?1, ?2, 'text', 'App', NULL, NULL, '[]', 20, 0, ?3, ?4)",
            rusqlite::params![id, "unique searchable content here", now, now],
        ).expect("insert");

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items i JOIN items_fts ON items_fts.rowid = i.rowid AND items_fts MATCH 'searchable'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_dedup_detection() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, tags, char_count, is_archived, created_at, updated_at)
             VALUES ('id1', 'duplicate text', 'text', 'App', '[]', 14, 0, ?1, ?2)",
            rusqlite::params![now, now],
        ).expect("insert");

        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM (SELECT content FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 100) WHERE content = ?1",
            rusqlite::params!["duplicate text"],
            |row| row.get(0),
        ).unwrap();
        assert!(exists, "Should detect duplicate");

        let not_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM (SELECT content FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 100) WHERE content = ?1",
            rusqlite::params!["different text"],
            |row| row.get(0),
        ).unwrap();
        assert!(!not_exists, "Should not detect non-duplicate");
    }

    #[test]
    fn test_archived_items_not_in_dedup() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert as archived
        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, tags, char_count, is_archived, created_at, updated_at)
             VALUES ('id1', 'archived text', 'text', 'App', '[]', 13, 1, ?1, ?2)",
            rusqlite::params![now, now],
        ).expect("insert");

        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM (SELECT content FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 100) WHERE content = ?1",
            rusqlite::params!["archived text"],
            |row| row.get(0),
        ).unwrap();
        assert!(!exists, "Archived items should not be in dedup check");
    }

    #[test]
    fn test_format_pack_chatgpt() {
        let pack = ContextPack {
            id: "p1".into(), title: "GPT Test".into(), description: Some("summary".into()),
            constraints: Some("constraint1".into()), questions: Some("q1".into()),
            item_ids: vec!["i1".into()], export_format: "chatgpt".into(),
            created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            meta: None, agent_log: None,
        };
        let items = vec![CaptureItem {
            id: "i1".into(), content: "Test content".into(), content_type: "text".into(),
            source_app: "Slack".into(), source_url: None, source_title: Some("Channel".into()),
            tags: vec![], char_count: 12, is_archived: false,
            created_at: "2026-03-28T14:30:00Z".into(), updated_at: "2026-03-28T14:30:00Z".into(),
            enrichment: None,
        }];
        let out = format_pack(&pack, &items, "chatgpt");
        assert!(out.contains("# Context Pack: GPT Test"));
        assert!(out.contains("**Summary:** summary"));
        assert!(out.contains("Test content"));
        assert!(out.contains("constraint1"));
    }

    #[test]
    fn test_format_pack_cursor() {
        let pack = ContextPack {
            id: "p1".into(), title: "Cursor Test".into(), description: Some("bg".into()),
            constraints: None, questions: None,
            item_ids: vec![], export_format: "cursor".into(),
            created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            meta: None, agent_log: None,
        };
        let out = format_pack(&pack, &[], "cursor");
        assert!(out.contains("# Project Context: Cursor Test"));
        assert!(out.contains("## Background"));
        assert!(out.contains("None specified"));
    }

    #[test]
    fn test_format_pack_empty_title() {
        let pack = ContextPack {
            id: "p1".into(), title: "".into(), description: None,
            constraints: None, questions: None,
            item_ids: vec![], export_format: "markdown".into(),
            created_at: "2026-03-28T12:00:00Z".into(), updated_at: "2026-03-28T12:00:00Z".into(),
            meta: None, agent_log: None,
        };
        let out = format_pack(&pack, &[], "markdown");
        assert!(out.contains("# Context Pack"), "Empty title should use fallback");
    }

    #[test]
    fn test_tags_table() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO tags (name, use_count, last_used_at, color_index) VALUES ('test-tag', 1, ?1, 3)",
            rusqlite::params![now],
        ).expect("insert tag");

        // Upsert same tag
        conn.execute(
            "INSERT INTO tags (name, use_count, last_used_at, color_index) VALUES ('test-tag', 1, ?1, 3) ON CONFLICT(name) DO UPDATE SET use_count = use_count + 1",
            rusqlite::params![now],
        ).expect("upsert tag");

        let count: i64 = conn.query_row("SELECT use_count FROM tags WHERE name = 'test-tag'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2, "Tag use_count should be incremented on upsert");
    }

    #[test]
    fn test_packs_table_crud() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO packs (id, title, description, constraints_text, questions, item_ids, export_format, created_at, updated_at) VALUES ('p1', 'Test', 'Desc', NULL, NULL, '[\"i1\",\"i2\"]', 'markdown', ?1, ?2)",
            rusqlite::params![now, now],
        ).expect("insert pack");

        let title: String = conn.query_row("SELECT title FROM packs WHERE id = 'p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Test");

        let item_ids: String = conn.query_row("SELECT item_ids FROM packs WHERE id = 'p1'", [], |r| r.get(0)).unwrap();
        let ids: Vec<String> = serde_json::from_str(&item_ids).unwrap();
        assert_eq!(ids, vec!["i1", "i2"]);

        // Delete
        conn.execute("DELETE FROM packs WHERE id = 'p1'", []).expect("delete");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM packs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_settings_table() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')", [],
        ).expect("insert");

        // Upsert
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'light') ON CONFLICT(key) DO UPDATE SET value = 'light'", [],
        ).expect("upsert");

        let val: String = conn.query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| r.get(0)).unwrap();
        assert_eq!(val, "light");
    }

    #[test]
    fn test_fts_update_sync() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, tags, char_count, is_archived, created_at, updated_at)
             VALUES ('u1', 'original content xyz', 'text', 'App', '[]', 20, 0, ?1, ?2)",
            rusqlite::params![now, now],
        ).expect("insert");

        // FTS should find original
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'xyz'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        // Update content
        conn.execute("UPDATE items SET content = 'updated content abc' WHERE id = 'u1'", []).expect("update");

        // FTS should find new content
        let count_new: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'abc'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count_new, 1, "FTS should find updated content");

        // FTS should NOT find old content
        let count_old: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'xyz'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count_old, 0, "FTS should not find old content after update");
    }

    #[test]
    fn test_fts_delete_sync() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO items (id, content, content_type, source_app, tags, char_count, is_archived, created_at, updated_at)
             VALUES ('d1', 'deletable content zzz', 'text', 'App', '[]', 21, 0, ?1, ?2)",
            rusqlite::params![now, now],
        ).expect("insert");

        conn.execute("DELETE FROM items WHERE id = 'd1'", []).expect("delete");

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'zzz'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0, "FTS should be cleaned up after delete");
    }

    #[test]
    fn test_fmt_time_edge_cases() {
        // December
        assert_eq!(fmt_time("2026-12-25T00:00:00Z"), "Dec 25, 00:00");
        // Single digit day
        assert_eq!(fmt_time("2026-03-01T23:59:00Z"), "Mar 1, 23:59");
        // Very short string
        assert_eq!(fmt_time(""), "");
        assert_eq!(fmt_time("2026"), "2026");
    }

    #[test]
    fn test_tag_color_deterministic() {
        // Same tag should always give same color
        let c1 = tag_color_index("research");
        let c2 = tag_color_index("research");
        assert_eq!(c1, c2, "Same tag must produce same color index");
    }

    #[test]
    fn test_multiple_items_ordering() {
        let db = make_test_db();
        let conn = db.conn.lock().unwrap();

        for i in 0..5 {
            let now = format!("2026-03-28T{:02}:00:00Z", 10 + i);
            conn.execute(
                "INSERT INTO items (id, content, content_type, source_app, tags, char_count, is_archived, created_at, updated_at)
                 VALUES (?1, ?2, 'text', 'App', '[]', 10, 0, ?3, ?4)",
                rusqlite::params![format!("id{}", i), format!("item {}", i), now, now],
            ).expect("insert");
        }

        // Query ordered by created_at DESC
        let mut stmt = conn.prepare("SELECT id FROM items ORDER BY created_at DESC LIMIT 5").unwrap();
        let ids: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(ids, vec!["id4", "id3", "id2", "id1", "id0"], "Items should be newest first");
    }
}

// ── Model / Hardware ──

#[tauri::command]
pub fn check_model_status() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let model_path = format!("{}/.research-inbox/models/gemma-4-2b-q4_k_m.gguf", home);
    let exists = std::path::Path::new(&model_path).exists();
    Ok(serde_json::json!({
        "downloaded": exists,
        "path": model_path,
    }))
}

#[tauri::command]
pub fn check_hardware() -> Result<serde_json::Value, String> {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| e.to_string())?;
    let ram_bytes: u64 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .unwrap_or(0);
    let ram_gb = ram_bytes / (1024 * 1024 * 1024);
    Ok(serde_json::json!({
        "ram_gb": ram_gb,
        "meets_minimum": ram_gb >= 8,
    }))
}

#[tauri::command]
pub async fn download_model(app: tauri::AppHandle) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let model_dir = format!("{}/.research-inbox/models", home);
    std::fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;

    let model_path = format!("{}/gemma-4-2b-q4_k_m.gguf", model_dir);

    // Already downloaded?
    if std::path::Path::new(&model_path).exists() {
        return Ok(model_path);
    }

    // For alpha: emit a placeholder progress event and return error.
    // Real download will be wired when we have the actual model URL.
    let _ = app.emit("model-download-progress", serde_json::json!({
        "downloaded": 0,
        "total": 0,
        "percent": 0,
        "status": "not_available",
    }));

    // Don't add reqwest dependency yet – just return the path placeholder.
    // The actual HTTP download will be added when Gemma 4 GGUF URL is available.
    Err("Model download not yet available. Place model manually at: ".to_string() + &model_path)
}
