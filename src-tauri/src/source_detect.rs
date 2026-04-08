use crate::models::AppInfo;

#[cfg(target_os = "macos")]
pub fn get_foreground_app() -> AppInfo {
    use std::process::Command;

    // Use osascript for reliable app name + window title detection
    let app_name = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to get name of first application process whose frontmost is true"#)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let window_title = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to get title of front window of first application process whose frontmost is true"#)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let url_from_title = extract_url_from_title(&window_title, &app_name);

    AppInfo {
        app_name,
        window_title,
        url_from_title,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_foreground_app() -> AppInfo {
    AppInfo {
        app_name: "Unknown".to_string(),
        window_title: String::new(),
        url_from_title: None,
    }
}

pub fn extract_url_from_title(title: &str, app_name: &str) -> Option<String> {
    let browsers = ["Google Chrome", "Chrome", "Arc", "Safari", "Firefox", "Edge", "Brave", "Opera", "Vivaldi"];
    if !browsers.iter().any(|b| app_name.contains(b)) {
        return None;
    }

    // Try to extract URL from window title
    for word in title.split_whitespace() {
        if (word.starts_with("http://") || word.starts_with("https://")) && word.contains('.') {
            return Some(word.to_string());
        }
    }
    // Some browsers show "Page Title - domain.com - Browser"
    let parts: Vec<&str> = title.split(" - ").collect();
    for part in parts.iter().rev() {
        let trimmed = part.trim();
        if trimmed.contains('.') && !trimmed.contains(' ') && trimmed.len() > 3 {
            return Some(format!("https://{}", trimmed));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_url_from_chrome_title() {
        // "google/zx" has a slash so it's not detected as domain — correct behavior
        let url = extract_url_from_title("GitHub - google/zx - Google Chrome", "Google Chrome");
        assert_eq!(url, None);

        // Real domain in title
        let url = extract_url_from_title("My Page - example.com - Google Chrome", "Google Chrome");
        assert_eq!(url, Some("https://example.com".to_string()));
    }

    #[test]
    fn test_extract_url_with_https() {
        let url = extract_url_from_title("My Page https://example.com/page", "Google Chrome");
        assert_eq!(url, Some("https://example.com/page".to_string()));
    }

    #[test]
    fn test_no_url_for_non_browser() {
        let url = extract_url_from_title("Some Window Title", "Telegram");
        assert_eq!(url, None);
    }

    #[test]
    fn test_extract_url_arc() {
        let url = extract_url_from_title("docs.rs - Arc", "Arc");
        assert_eq!(url, Some("https://docs.rs".to_string()));
    }

    #[test]
    fn test_no_url_for_plain_title() {
        let url = extract_url_from_title("My Document", "Google Chrome");
        assert_eq!(url, None);
    }
}
