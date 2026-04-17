mod ai;
mod commands;
mod db;
mod models;
mod source_detect;

use db::Database;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSWindow, NSWindowCollectionBehavior};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::sync::Arc;
use tauri::{
    image::Image,
    include_image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    ActivationPolicy, AppHandle, Emitter, Manager, RunEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_positioner::{Position as AnchorPosition, WindowExt};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

const TRAY_ICON: Image<'_> = include_image!("./icons/tray-icon@2x.png");
const PANEL_WIDTH: f64 = 520.0;
const PANEL_HEIGHT: f64 = 760.0;
const OVERLAY_WIDTH: f64 = 468.0;

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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            dbg("single-instance wake");
            show_panel(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_positioner::init())
        .manage(database)
        .setup(|app| {
            dbg("STARTUP");

            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(ActivationPolicy::Regular);
                let _ = app.set_dock_visibility(true);
            }

            // ── macOS window vibrancy (frosted glass behind our UI) ──
            // Panel = Sidebar material (Finder-like), Overlay = HUD material (Spotlight-like).
            // Rounded corners via a 12px radius so the WebView content matches the window mask.
            #[cfg(target_os = "macos")]
            {
                if let Some(panel_w) = app.get_webview_window("panel") {
                    let _ = apply_vibrancy(
                        &panel_w,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        Some(12.0),
                    )
                    .map_err(|e| dbg(&format!("panel vibrancy failed: {}", e)));
                }
                if let Some(overlay_w) = app.get_webview_window("overlay") {
                    let _ = apply_vibrancy(
                        &overlay_w,
                        NSVisualEffectMaterial::HudWindow,
                        Some(NSVisualEffectState::Active),
                        Some(12.0),
                    )
                    .map_err(|e| dbg(&format!("overlay vibrancy failed: {}", e)));
                }
            }

            // System tray menu — v2.5 adds the explicit "Reset position" actions
            // required by §4.2/§4.3 mobility so users can snap windows back to
            // their defaults without hunting through Settings.
            let capture_item = MenuItemBuilder::with_id("capture", "Capture  ⇧⌘S").build(app)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show_item = MenuItemBuilder::with_id("show", "Open Inbox").build(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let reset_overlay_item =
                MenuItemBuilder::with_id("reset_overlay_position", "Recenter Overlay")
                    .build(app)?;
            let reset_panel_item =
                MenuItemBuilder::with_id("reset_panel_position", "Snap Inbox to Tray Anchor")
                    .build(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Research Inbox").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&capture_item)
                .item(&sep1)
                .item(&show_item)
                .item(&reset_overlay_item)
                .item(&reset_panel_item)
                .item(&sep2)
                .item(&sep3)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(TRAY_ICON)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "capture" => {
                        do_capture_flow(app);
                    }
                    "show" => {
                        show_panel(app);
                    }
                    "reset_overlay_position" => {
                        let _ = commands::reset_window_position(app.clone(), "overlay".to_string());
                    }
                    "reset_panel_position" => {
                        let _ = commands::reset_window_position(app.clone(), "panel".to_string());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                })
                .build(app)?;

            // ⇧⌘S = The ONE hotkey: capture selected text if possible; otherwise
            // fall through into screenshot mode. It should never feel like a dead press.
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

            // ── Sidecar setup ──
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let model_path = std::path::PathBuf::from(&home)
                .join(".research-inbox")
                .join("models")
                .join("gemma-4-e2b-it-Q8_0.gguf");
            let sidecar = Arc::new(ai::sidecar::SidecarManager::new(model_path));
            app.manage(sidecar.clone());

            // Watchdog: check every 30s, kill sidecar if TTL expired while Ready
            let sidecar_watchdog = sidecar.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if sidecar_watchdog.state() == ai::sidecar::SidecarState::Ready
                    && sidecar_watchdog.ttl_expired()
                {
                    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
                    let path = format!("{}/.research-inbox/debug.log", home);
                    if let Ok(mut f) = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&path)
                    {
                        let _ = std::io::Write::write_all(
                            &mut f,
                            b"[watchdog] TTL expired, killing sidecar\n",
                        );
                    }
                    sidecar_watchdog.kill();
                }
            });

            dbg("SETUP complete");
            show_panel(app.handle());
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
            commands::open_screen_capture_settings,
            commands::check_screen_capture_permission,
            commands::save_window_position,
            commands::load_window_position,
            commands::reset_window_position,
            commands::refocus_app,
            commands::trigger_text_capture,
            commands::trigger_screenshot_capture,
            commands::check_model_status,
            commands::check_hardware,
            commands::download_model,
            commands::enrich_item,
            commands::semantic_search,
            commands::generate_pack,
            commands::chat_pack_agent,
            commands::get_clusters,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::Ready => {
                show_panel(app);
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_panel(app);
                }
            }
            _ => {}
        });
}

struct ClipboardSnapshot {
    text: Option<String>,
    image_rgba: Option<Vec<u8>>,
    image_width: u32,
    image_height: u32,
}

fn snapshot_clipboard(app: &AppHandle) -> ClipboardSnapshot {
    let text = app
        .clipboard()
        .read_text()
        .ok()
        .filter(|value| !value.is_empty());
    let image = app.clipboard().read_image().ok();

    ClipboardSnapshot {
        text,
        image_rgba: image.as_ref().map(|img| img.rgba().to_vec()),
        image_width: image.as_ref().map(|img| img.width()).unwrap_or(0),
        image_height: image.as_ref().map(|img| img.height()).unwrap_or(0),
    }
}

fn restore_clipboard(app: &AppHandle, snapshot: &ClipboardSnapshot) {
    if let Some(text) = &snapshot.text {
        let _ = app.clipboard().write_text(text.clone());
        return;
    }

    if let Some(bytes) = &snapshot.image_rgba {
        let image = Image::new_owned(bytes.clone(), snapshot.image_width, snapshot.image_height);
        let _ = app.clipboard().write_image(&image);
        return;
    }

    let _ = app.clipboard().clear();
}

fn read_selected_text_ax() -> Option<String> {
    let binary = find_script("get_selected_text");
    let output = std::process::Command::new(&binary).output().ok()?;
    if !output.status.success() && output.status.code() != Some(0) {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn simulate_copy_command() -> bool {
    let binary = find_script("simulate_copy");
    std::process::Command::new(&binary)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn collect_text_capture_payload(app: &AppHandle) -> Option<String> {
    let app_info = source_detect::get_foreground_app();

    // 1. Accessibility fast path: if we can read the selected text directly, do
    // that first and avoid touching the clipboard altogether.
    if let Some(selected_text) = read_selected_text_ax() {
        return Some(
            serde_json::json!({
                "app_name": app_info.app_name,
                "window_title": app_info.window_title,
                "url_from_title": app_info.url_from_title,
                "selected_text": selected_text,
                "image_paths": Vec::<String>::new(),
            })
            .to_string(),
        );
    }

    // 2. Clipboard fallback for apps where AX selected-text is unavailable.
    let snapshot = snapshot_clipboard(app);
    let did_copy = simulate_copy_command();
    std::thread::sleep(std::time::Duration::from_millis(300));

    // 3. Read clipboard again, then restore the user's original clipboard no
    // matter what the capture result is.
    let clip = read_clipboard_rich();
    restore_clipboard(app, &snapshot);

    // 4. Text-first rule: if copy did not produce new text, this is not a text
    // capture. The caller can fall back to screenshot or show the explicit empty state.
    if !did_copy || clip.text.trim().is_empty() {
        return None;
    }

    // 5. Build payload for the overlay save path.
    Some(
        serde_json::json!({
            "app_name": app_info.app_name,
            "window_title": app_info.window_title,
            "url_from_title": app_info.url_from_title,
            "selected_text": clip.text,
            "image_paths": Vec::<String>::new(),
        })
        .to_string(),
    )
}

pub(crate) fn trigger_text_capture_flow(app: &AppHandle) {
    dbg("trigger_text_capture_flow");

    if let Some(payload) = collect_text_capture_payload(app) {
        let _ = app.emit("capture-triggered", payload);
    } else {
        let _ = app.emit(
            "capture-error",
            serde_json::json!({
                "kind": "empty",
                "message": "Nothing selected to capture."
            }),
        );
    }
}

/// The main capture flow triggered by ⇧⌘S or tray menu:
/// 1. Detect foreground app
/// 2. Try AX API first (no clipboard touch, ~10ms)
/// 3. If AX fails → fall back to ⌘C + clipboard save/restore
/// 4. Emit capture event with the selected text
/// 5. Show overlay at top-center
/// 6. If no text was selected, trigger screenshot mode instead of no-oping
fn do_capture_flow(app: &AppHandle) {
    dbg("do_capture_flow");

    // 6. Show overlay — saved position wins if still on-screen, else top-center default.
    //    §4.2 Overlay mobility: position persists between launches and is clamped to
    //    visible screen bounds after monitor/resolution changes.
    if let Some(w) = app.get_webview_window("overlay") {
        if let Ok(Some(m)) = w.primary_monitor() {
            let scale = m.scale_factor();
            let screen_w = m.size().width as f64 / scale;
            let screen_h = m.size().height as f64 / scale;
            let overlay_h = 68.0_f64;

            let default_x = ((screen_w - OVERLAY_WIDTH) / 2.0).max(20.0);
            let default_y = 80.0_f64;

            let (x, y) = match commands::lookup_window_position("overlay") {
                Some((sx, sy))
                    if sx >= 0.0
                        && sy >= 0.0
                        && sx + OVERLAY_WIDTH <= screen_w
                        && sy + overlay_h <= screen_h =>
                {
                    (sx, sy)
                }
                _ => (default_x, default_y),
            };

            let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
        let _ = w.show();
        let _ = w.set_focus();
    }

    // 7. If content was captured → emit capture event
    //    If nothing → emit screenshot activation
    if let Some(payload) = collect_text_capture_payload(app) {
        let _ = app.emit("capture-triggered", payload);
    } else {
        let _ = app.emit("screenshot-activate", ());
    }
}

struct ClipboardContent {
    text: String,
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
                return ClipboardContent { text };
            }
        }
        Ok(o) => {
            dbg(&format!(
                "clipboard_read failed: {}",
                String::from_utf8_lossy(&o.stderr)
            ));
        }
        Err(e) => {
            dbg(&format!("clipboard_read error: {}", e));
        }
    }
    let text = get_clipboard_text_only().unwrap_or_default();
    ClipboardContent { text }
}

/// Read plain text only via pbpaste (used for old clipboard snapshot)
fn get_clipboard_text_only() -> Option<String> {
    use std::process::Command;
    let output = Command::new("pbpaste").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
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
                tap: u32,
                place: u32,
                options: u32,
                events_of_interest: u64,
                callback: extern "C" fn(
                    u32,
                    u32,
                    *mut std::ffi::c_void,
                    *mut std::ffi::c_void,
                ) -> *mut std::ffi::c_void,
                user_info: *mut std::ffi::c_void,
            ) -> *mut std::ffi::c_void;
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        extern "C" fn dummy_callback(
            _: u32,
            _: u32,
            event: *mut std::ffi::c_void,
            _: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void {
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
    let bundle = exe_dir
        .parent()
        .unwrap_or(exe_dir)
        .join("Resources")
        .join("scripts")
        .join(name);
    if bundle.exists() {
        return bundle.to_string_lossy().to_string();
    }
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join(name);
    if dev.exists() {
        return dev.to_string_lossy().to_string();
    }
    name.to_string()
}

fn show_panel(app: &AppHandle) {
    dbg("show_panel");
    if let Some(w) = app.get_webview_window("panel") {
        #[cfg(target_os = "macos")]
        {
            let _ = app.set_activation_policy(ActivationPolicy::Regular);
            let _ = app.set_dock_visibility(true);
            if let Err(err) = app.show() {
                dbg(&format!("app.show failed: {}", err));
            }
        }

        let visible_before = w.is_visible().unwrap_or(false);
        dbg(&format!("panel visible before: {}", visible_before));

        if let Ok(Some(m)) = w.primary_monitor() {
            let scale = m.scale_factor();
            let screen_w = m.size().width as f64 / scale;
            let screen_h = m.size().height as f64 / scale;
            // §4.3 Inbox mobility: keep tray-anchored default on first launch,
            // then respect user-chosen position if it still fits on the current display.
            let default_x = ((screen_w - PANEL_WIDTH) / 2.0).max(20.0);
            let default_y = ((screen_h - PANEL_HEIGHT) / 5.0).max(48.0);
            let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                PANEL_WIDTH,
                PANEL_HEIGHT,
            )));

            match commands::lookup_window_position("panel") {
                Some((sx, sy))
                    if sx >= 0.0
                        && sy >= 0.0
                        && sx + PANEL_WIDTH <= screen_w
                        && sy + PANEL_HEIGHT <= screen_h =>
                {
                    let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                        sx, sy,
                    )));
                    dbg(&format!("panel target pos: {}, {}", sx, sy));
                }
                _ => {
                    if let Err(err) = w.as_ref().window().move_window(AnchorPosition::TrayCenter) {
                        dbg(&format!("panel tray anchor failed: {}", err));
                        let _ = w.set_position(tauri::Position::Logical(
                            tauri::LogicalPosition::new(default_x, default_y),
                        ));
                        dbg(&format!("panel fallback pos: {}, {}", default_x, default_y));
                    } else {
                        dbg("panel anchored to tray");
                    }
                }
            }
        }

        if !visible_before {
            if let Err(err) = w.show() {
                dbg(&format!("panel show failed: {}", err));
            }
        }
        if let Err(err) = w.unminimize() {
            dbg(&format!("panel unminimize failed: {}", err));
        }
        if let Err(err) = w.set_focus() {
            dbg(&format!("panel focus failed: {}", err));
        }
        #[cfg(target_os = "macos")]
        {
            let window = w.clone();
            let _ = w.run_on_main_thread(move || {
                if let Some(mtm) = MainThreadMarker::new() {
                    let app = NSApplication::sharedApplication(mtm);
                    app.activate();
                    dbg("native app activate");
                }
                if let Ok(ns_window_ptr) = window.ns_window() {
                    let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };
                    let behavior = ns_window.collectionBehavior();
                    ns_window.setCollectionBehavior(
                        behavior | NSWindowCollectionBehavior::MoveToActiveSpace,
                    );
                    // v2.5: do NOT call ns_window.center() — it overrides the
                    // persisted user-chosen position set in set_position() above.
                    ns_window.makeKeyAndOrderFront(None);
                    ns_window.orderFrontRegardless();
                    dbg("native panel order front");
                }
            });
        }

        dbg(&format!(
            "panel visible after: {}",
            w.is_visible().unwrap_or(false)
        ));
    }
}

fn dirs_data_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".research-inbox")
}
