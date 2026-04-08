mod commands;
mod db;
mod models;
mod source_detect;

use db::Database;
use tauri::{
    AppHandle, Emitter, Manager,
    tray::TrayIconBuilder,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

fn dbg(msg: &str) {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let path = format!("{}/.research-inbox/debug.log", home);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&path)
    {
        let _ = writeln!(f, "{}", msg);
        let _ = f.flush();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs_data_dir();
    let database = Database::new(data_dir).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(database)
        .setup(|app| {
            dbg("STARTUP");

            // System tray menu
            let capture_item = MenuItemBuilder::with_id("capture", "Capture  ⇧⌘S").build(app)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show_item = MenuItemBuilder::with_id("show", "Open Inbox").build(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Research Inbox").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&capture_item)
                .item(&sep1)
                .item(&show_item)
                .item(&sep2)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "capture" => {
                            do_capture_flow(app);
                        }
                        "show" => {
                            toggle_panel(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|_tray, _event| {})
                .build(app)?;

            // ⇧⌘S = The ONE hotkey: auto-capture clipboard + show overlay + activate screenshot
            app.global_shortcut().on_shortcut(
                "Shift+Super+S",
                move |app_handle: &AppHandle, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        dbg("HOTKEY Shift+Super+S");
                        do_capture_flow(app_handle);
                    }
                },
            )?;

            // Request Input Monitoring permission — triggers macOS prompt on first launch.
            // CGEventTapCreate with listenOnly causes macOS to add us to the Input Monitoring list.
            request_input_monitoring();

            dbg("SETUP complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_item,
            commands::capture_screenshot,
            commands::check_duplicate,
            commands::list_items,
            commands::search_items,
            commands::update_item,
            commands::delete_item,
            commands::list_tags,
            commands::create_pack,
            commands::update_pack,
            commands::list_packs,
            commands::export_pack,
            commands::delete_pack,
            commands::get_settings,
            commands::update_settings,
            commands::get_foreground_app_cmd,
            commands::check_accessibility,
            commands::open_accessibility_settings,
            commands::open_input_monitoring_settings,
            commands::refocus_app,
            commands::trigger_text_capture,
            commands::trigger_screenshot_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The main capture flow triggered by ⇧⌘S or tray menu:
/// 1. Detect foreground app
/// 2. Try AX API first (no clipboard touch, ~10ms)
/// 3. If AX fails → fall back to ⌘C + clipboard save/restore
/// 4. Emit capture event with the selected text
/// 5. Show overlay at top-center
/// 6. Trigger screenshot mode
fn do_capture_flow(app: &AppHandle) {
    dbg("do_capture_flow");

    // 1. Detect foreground app NOW
    let app_info = source_detect::get_foreground_app();
    dbg(&format!("app: {}", app_info.app_name));

    // 2. Snapshot old clipboard via same binary (consistent comparison)
    let old_clip = read_clipboard_rich();
    dbg(&format!("old: text_len={}, images={}", old_clip.text.len(), old_clip.image_paths.len()));

    // 3. Simulate ⌘C
    simulate_cmd_c();
    std::thread::sleep(std::time::Duration::from_millis(300));

    // 4. Read clipboard again (including HTML images)
    let clip = read_clipboard_rich();
    dbg(&format!("new: text_len={}, images={}", clip.text.len(), clip.image_paths.len()));

    // Did clipboard change? (text changed OR new images appeared)
    let has_new_content = clip.text != old_clip.text
        || (!clip.image_paths.is_empty() && clip.image_paths != old_clip.image_paths);

    dbg(&format!("has_new_content: {}", has_new_content));

    // 5. Build payload — include text + image paths
    let payload_obj = serde_json::json!({
        "app_name": app_info.app_name,
        "window_title": app_info.window_title,
        "url_from_title": app_info.url_from_title,
        "selected_text": if has_new_content && !clip.text.is_empty() { clip.text.as_str() } else { "" },
        "image_paths": if has_new_content { clip.image_paths.clone() } else { Vec::<String>::new() },
    });

    // 6. Show overlay at top-center
    if let Some(w) = app.get_webview_window("overlay") {
        if let Ok(monitor) = w.primary_monitor() {
            if let Some(m) = monitor {
                let screen_w = m.size().width as f64 / m.scale_factor();
                let overlay_w = 420.0;
                let x = ((screen_w - overlay_w) / 2.0) as i32;
                let y = 80;
                let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x as f64, y as f64)));
            }
        }
        let _ = w.show();
        let _ = w.set_focus();
    }

    // 7. If content was captured → emit capture event
    //    If nothing → emit screenshot activation
    if has_new_content {
        let _ = app.emit("capture-triggered", payload_obj.to_string());
    } else {
        let _ = app.emit("screenshot-activate", ());
    }
}

/// Simulate ⌘C using CGEvent directly from our Rust process.
/// Requires BOTH Accessibility AND Input Monitoring permissions for our .app.
fn simulate_cmd_c() {
    dbg("simulate_cmd_c: CGEvent in-process");
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CGEventSourceCreate(stateID: i32) -> *mut std::ffi::c_void;
            fn CGEventCreateKeyboardEvent(source: *mut std::ffi::c_void, keycode: u16, key_down: bool) -> *mut std::ffi::c_void;
            fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
            fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        unsafe {
            // Use HIDSystemState (1) — this source type is what Maccy uses for synthetic input
            let source = CGEventSourceCreate(1);
            dbg(&format!("CGEvent source null: {}", source.is_null()));

            let key_c: u16 = 8;
            let cmd_flag: u64 = 0x00100000; // kCGEventFlagMaskCommand

            let key_down = CGEventCreateKeyboardEvent(source, key_c, true);
            if !key_down.is_null() {
                CGEventSetFlags(key_down, cmd_flag);
                CGEventPost(0, key_down); // kCGHIDEventTap = 0
                dbg("CGEvent key_down posted");
            }

            std::thread::sleep(std::time::Duration::from_millis(50));

            let key_up = CGEventCreateKeyboardEvent(source, key_c, false);
            if !key_up.is_null() {
                CGEventSetFlags(key_up, cmd_flag);
                CGEventPost(0, key_up);
                dbg("CGEvent key_up posted");
            }

            if !key_down.is_null() { CFRelease(key_down); }
            if !key_up.is_null() { CFRelease(key_up); }
            if !source.is_null() { CFRelease(source); }
        }
    }
}

struct ClipboardContent {
    text: String,
    image_paths: Vec<String>,
}

/// Read rich clipboard (text + images) via compiled Swift binary.
/// Handles: raw image data, HTML with <img> tags (downloads them), plain text.
fn read_clipboard_rich() -> ClipboardContent {
    use std::process::Command;

    let binary = find_script("clipboard_read");
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let images_dir = format!("{}/.research-inbox/images", home);

    let output = Command::new(&binary).arg(&images_dir).output();
    match output {
        Ok(o) if o.status.success() => {
            let json_str = String::from_utf8_lossy(&o.stdout);
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                let text = v["text"].as_str().unwrap_or("").to_string();
                let image_paths: Vec<String> = v["image_paths"].as_array()
                    .map(|arr| arr.iter().filter_map(|p| p.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                return ClipboardContent { text, image_paths };
            }
        }
        Ok(o) => { dbg(&format!("clipboard_read failed: {}", String::from_utf8_lossy(&o.stderr))); }
        Err(e) => { dbg(&format!("clipboard_read error: {}", e)); }
    }
    let text = get_clipboard_text_only().unwrap_or_default();
    ClipboardContent { text, image_paths: vec![] }
}

/// Read plain text only via pbpaste (used for old clipboard snapshot)
fn get_clipboard_text_only() -> Option<String> {
    use std::process::Command;
    let output = Command::new("pbpaste").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.is_empty() { None } else { Some(text) }
}

/// Find a bundled script binary (checks bundle Resources, then dev path)
/// Request Input Monitoring permission by creating a CGEventTap.
/// This triggers macOS to show the permission prompt and add our app to the list.
/// The tap is immediately released — we don't actually need to monitor input.
fn request_input_monitoring() {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventTapCreate(
                tap: u32, place: u32, options: u32,
                events_of_interest: u64,
                callback: extern "C" fn(u32, u32, *mut std::ffi::c_void, *mut std::ffi::c_void) -> *mut std::ffi::c_void,
                user_info: *mut std::ffi::c_void,
            ) -> *mut std::ffi::c_void;
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        extern "C" fn dummy_callback(_: u32, _: u32, event: *mut std::ffi::c_void, _: *mut std::ffi::c_void) -> *mut std::ffi::c_void {
            event
        }

        unsafe {
            let key_down_mask: u64 = 1 << 10; // kCGEventKeyDown
            let tap = CGEventTapCreate(
                1, // kCGSessionEventTap
                0, // kCGHeadInsertEventTap
                1, // kCGEventTapOptionListenOnly
                key_down_mask,
                dummy_callback,
                std::ptr::null_mut(),
            );
            if !tap.is_null() {
                dbg("Input Monitoring: tap created (permission granted or prompt shown)");
                CFRelease(tap);
            } else {
                dbg("Input Monitoring: tap failed (permission needed — user should see macOS prompt)");
            }
        }
    }
}

fn find_script(name: &str) -> String {
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let bundle = exe_dir.parent().unwrap_or(exe_dir).join("Resources").join("scripts").join(name);
    if bundle.exists() { return bundle.to_string_lossy().to_string(); }
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts").join(name);
    if dev.exists() { return dev.to_string_lossy().to_string(); }
    name.to_string()
}


fn toggle_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("panel") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn dirs_data_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".research-inbox")
}
