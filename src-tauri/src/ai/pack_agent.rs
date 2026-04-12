use crate::db::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedPack {
    pub title: String,
    pub summary: String,
    pub item_ids: Vec<String>,
    pub audience: String,
    pub tone: String,
    pub purpose: String,
}

/// Generate a pack from natural language intent.
/// Uses keyword matching + recency. Will be replaced by LLM.
pub fn generate_pack_from_intent(
    db: &Database,
    intent: &str,
) -> Result<GeneratedPack, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lower = intent.to_lowercase();

    // Find items matching intent keywords via FTS
    let search_term = intent.split_whitespace()
        .filter(|w| w.len() > 3)
        .collect::<Vec<_>>()
        .join(" OR ");

    let query = if search_term.is_empty() {
        "SELECT id, content, source_app, tags, created_at FROM items WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 15".to_string()
    } else {
        format!(
            "SELECT i.id, i.content, i.source_app, i.tags, i.created_at
             FROM items i
             JOIN items_fts fts ON i.rowid = fts.rowid
             WHERE items_fts MATCH '{}'
             AND i.is_archived = 0
             ORDER BY i.created_at DESC
             LIMIT 15",
            search_term.replace('\'', "''")
        )
    };

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let items: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    if items.is_empty() {
        return Err("No matching captures found for this intent.".to_string());
    }

    let item_ids: Vec<String> = items.iter().map(|(id, _)| id.clone()).collect();

    // Infer audience/tone from intent
    let audience = if lower.contains("ceo") || lower.contains("board") {
        "executive"
    } else if lower.contains("dev") || lower.contains("engineer") {
        "technical"
    } else {
        "general"
    }.to_string();

    let tone = if lower.contains("formal") || audience == "executive" {
        "formal"
    } else {
        "casual"
    }.to_string();

    // Generate title from intent
    let title = intent.chars().take(50).collect::<String>();

    // Summary from first few items
    let summary = items.iter()
        .take(3)
        .map(|(_, content)| content.chars().take(60).collect::<String>())
        .collect::<Vec<_>>()
        .join(". ");

    Ok(GeneratedPack {
        title,
        summary: if summary.len() > 200 { format!("{}...", &summary[..200]) } else { summary },
        item_ids,
        audience,
        tone,
        purpose: intent.to_string(),
    })
}

/// Modify an existing pack based on a chat instruction.
/// Returns a diff summary.
pub fn chat_modify_pack(
    db: &Database,
    pack_title: &str,
    pack_description: &str,
    pack_item_ids: &[String],
    instruction: &str,
) -> Result<serde_json::Value, String> {
    let lower = instruction.to_lowercase();

    let mut new_item_ids = pack_item_ids.to_vec();
    let mut diff_parts = Vec::new();

    // Handle "remove" instructions
    if lower.contains("remove") || lower.contains("убери") || lower.contains("удали") {
        let keyword = instruction.split_whitespace()
            .find(|w| w.len() > 4 && !["remove", "убери", "удали", "about", "section"].contains(w))
            .unwrap_or("");

        if !keyword.is_empty() {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let before_count = new_item_ids.len();

            new_item_ids.retain(|id| {
                let content: String = conn.query_row(
                    "SELECT content FROM items WHERE id = ?1", [id], |row| row.get(0)
                ).unwrap_or_default();
                !content.to_lowercase().contains(&keyword.to_lowercase())
            });

            let removed = before_count - new_item_ids.len();
            if removed > 0 {
                diff_parts.push(format!("Removed {} item(s) matching '{}'", removed, keyword));
            }
        }
    }

    // Handle "shorter"/"короче"
    if lower.contains("shorter") || lower.contains("короче") {
        let max = (new_item_ids.len() / 2).max(3);
        if new_item_ids.len() > max {
            let removed = new_item_ids.len() - max;
            new_item_ids.truncate(max);
            diff_parts.push(format!("Trimmed to {} items (-{})", max, removed));
        }
    }

    // Handle tone change
    let new_tone = if lower.contains("formal") || lower.contains("формальн") {
        diff_parts.push("Adjusted tone to formal".to_string());
        Some("formal")
    } else if lower.contains("casual") {
        diff_parts.push("Adjusted tone to casual".to_string());
        Some("casual")
    } else {
        None
    };

    let diff_summary = if diff_parts.is_empty() {
        "Instruction processed (no structural changes)".to_string()
    } else {
        diff_parts.join(". ") + "."
    };

    Ok(serde_json::json!({
        "title": pack_title,
        "summary": pack_description,
        "item_ids": new_item_ids,
        "tone": new_tone,
        "diff_summary": diff_summary,
    }))
}
