use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureItem {
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub source_app: String,
    pub source_url: Option<String>,
    pub source_title: Option<String>,
    pub tags: Vec<String>,
    pub char_count: i64,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub use_count: i64,
    pub last_used_at: String,
    pub color_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPack {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub constraints: Option<String>,
    pub questions: Option<String>,
    pub item_ids: Vec<String>,
    pub export_format: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub app_name: String,
    pub window_title: String,
    pub url_from_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub capture_hotkey: String,
    pub panel_hotkey: String,
    pub quick_tag_on_capture: bool,
    pub default_export_format: String,
    pub max_capture_size_kb: i64,
    pub launch_at_login: bool,
    pub theme: String,
    pub language: String,
    pub data_location: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            capture_hotkey: "Alt+Super+C".to_string(),
            panel_hotkey: "Alt+Super+R".to_string(),
            quick_tag_on_capture: false,
            default_export_format: "markdown".to_string(),
            max_capture_size_kb: 50,
            launch_at_login: true,
            theme: "system".to_string(),
            language: "en".to_string(),
            data_location: "~/.research-inbox/".to_string(),
        }
    }
}
