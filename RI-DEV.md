# RI-DEV.md — Research Inbox Development Decisions & Architecture

> **Purpose:** Get any dev or AI agent up to speed on every decision, what we tried, what we shipped, what we killed and why. This is the source of truth for "why is the code like this."
>
> **Rule:** Every significant change must be logged here. If you change capture flow, overlay behavior, hotkey logic, or architecture — update this doc or you're creating tech debt.

---

## 1. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Tauri v2 (Rust + WebView) | Cross-platform (macOS now, Windows next), ~13MB binary, native system tray, Rust for perf-critical clipboard/screenshot ops |
| Frontend | React 19 + TypeScript + Vite | Fast iteration, Claude Code proficiency |
| Styling | Tailwind CSS v4 | Utility-first, no CSS modules overhead, dark theme via CSS vars |
| State | Zustand | Lightweight, no boilerplate, single store |
| DB | SQLite (rusqlite, bundled) + FTS5 | Local-first, WAL mode, full-text search via FTS5 virtual table with sync triggers |
| OCR | Apple Vision framework (compiled Swift binary `scripts/ocr`) | On-device, accurate, supports en/ru/de/fr/es/zh |

**Rejected stacks:**
- **Electron** — too heavy (~150MB vs ~13MB), overkill for a menu bar utility
- **SQLCipher** — deferred to Phase 0.5, plain SQLite for alpha (10-15 users don't need encryption yet)
- **tauri-plugin-sql** — we use rusqlite directly because FTS5 virtual tables and sync triggers need raw SQL control

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│ macOS                                         │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Tray Icon │  │ Overlay  │  │    Panel    │ │
│  │ (menu)    │  │ (capture │  │  (inbox,    │ │
│  │           │  │  confirm)│  │  packs,     │ │
│  │           │  │  420×56  │  │  settings)  │ │
│  │           │  │ top-ctr  │  │  380×560    │ │
│  │           │  │ alwaysOn │  │  NOT on top │ │
│  └──────────┘  └──────────┘  └─────────────┘ │
│       │              │              │         │
│       └──────────────┴──────────────┘         │
│                      │                        │
│              ┌───────┴───────┐                │
│              │  Rust Backend  │                │
│              │  (lib.rs)      │                │
│              │  - ⇧⌘S hotkey  │                │
│              │  - ⌘C simulate │                │
│              │  - source app  │                │
│              │  - screencap   │                │
│              │  - OCR binary  │                │
│              │  - SQLite CRUD │                │
│              └───────┬───────┘                │
│                      │                        │
│              ┌───────┴───────┐                │
│              │ ~/.research-   │                │
│              │  inbox/data.db │                │
│              │  images/*.png  │                │
│              └───────────────┘                │
└──────────────────────────────────────────────┘
```

**Two Tauri windows (tauri.conf.json):**
- `overlay` — capture confirmation bar. 420×56, `alwaysOnTop: true`, `skipTaskbar: true`, `decorations: false`. URL: `/overlay.html`. Positioned programmatically at top-center via `set_position()`.
- `panel` — full inbox UI. 380×560, `alwaysOnTop: false`, `decorations: false`. URL: `/` (index.html).

**Capabilities (default.json):** Windows listed: `["main", "panel", "overlay"]`. If you add a new window label, you MUST add it here or its IPC calls silently fail.

**Single hotkey: ⇧⌘S** (`Shift+Super+S` in Tauri syntax) — does everything.

**Bundled resources:** `scripts/ocr` (Vision OCR binary), `scripts/get_selected_text` (AX API binary — compiled but not currently used in flow, kept for Phase 1 hybrid approach).

---

## 3. Critical User Path: ⇧⌘S Capture Flow

This is the #1 most important code path. If this breaks, the app is useless.

**Entry point:** `lib.rs::do_capture_flow(app: &AppHandle)`

```
User selects text in Arc/Slack/Chrome/etc
         │
         ▼
    Presses ⇧⌘S
         │
         ▼
  Rust: do_capture_flow()
    1. source_detect::get_foreground_app()
       → osascript, gets app name + window title + URL-from-title
    2. get_clipboard_text() via pbpaste — snapshot BEFORE ⌘C
    3. Simulate ⌘C — osascript keystroke "c" using command down
    4. sleep(150ms) — wait for clipboard update
    5. get_clipboard_text() again via pbpaste
    6. Compare old vs new clipboard
         │
    ┌────┴────┐
    │ CHANGED │ UNCHANGED
    │ (text   │ (nothing
    │ selected│  selected)
    ▼         ▼
  emit       emit
  "capture-  "screenshot-
  triggered"  activate"
  with JSON:  (no payload)
  {app_name,    │
   window_title,│
   url_from_    │
   title,       │
   selected_    │
   text}        │
    │           │
    ▼           ▼
  OVERLAY:    OVERLAY:
  shows →     shows →
  frontend    frontend
  saves to    calls
  SQLite      screencapture -i
  via IPC       │
    │      ┌────┴────┐
    │      │ Captured│ Esc
    │      ▼         ▼
    │    OCR runs  INTERACTIVE
    │    save to   state: user
    │    SQLite    sees buttons
    │      │       Clip | Screen | ✕
    │      ▼
    │    SUCCESS
    │    "✓ Screenshot saved"
    │    + OCR preview
    │    + source
    ▼      │
  SUCCESS  │
  "✓ Saved │
  to RI"   │
  + preview│
  + source │
    │      │
    ▼      ▼
  4 sec auto-dismiss timer
  (shrinking green progress bar)
    │
    ▼
  overlay.hide()
  invoke("refocus_app", {appName})
  → osascript: tell app to activate
```

### What we tried and rejected for text capture:

| # | Approach | Tested? | Result | Why rejected |
|---|----------|---------|--------|-------------|
| 1 | **AXSelectedText via osascript** | Yes, built | Slow (~500ms), unreliable in Chromium | AppleScript overhead + Arc/Electron apps don't expose AXSelectedText via this path |
| 2 | **AXSelectedText via compiled Swift binary** (`get_selected_text.swift`, uses C Accessibility API directly) | Yes, built + compiled, binary bundled | Fast (~10ms) but fails in Chromium/Electron apps | Arc, Slack desktop, VS Code don't implement AXSelectedText reliably. Would fail >30% for PMs who live in browsers. Binary kept in bundle for Phase 1 hybrid. |
| 3 | **⌘C simulation + clipboard save/restore** | Yes, built | Works everywhere but pollutes clipboard managers | Clipboard managers (Maccy, Paste) catch the restore pbcopy as a second clipboard event. Two events per capture = noise. |
| 4 | **⌘C via osascript** | Yes, first impl | Fails — osascript is a separate process without AX permission | Even though our app has Accessibility, spawned osascript does NOT inherit it. `"osascript is not allowed to send keystrokes"` error. |
| 5 | **⌘C via CGEvent FFI (in-process Rust)** | Yes | CGEvent posts but target app never receives it | macOS blocks synthetic keyboard events from being delivered cross-process even with AX permission. Tested with both HID tap (0) and session tap (1). Neither works. |
| 6 | **⌘C via compiled Swift binary (`simulate_copy`) bundled in .app** ✅ SHIPPED | Yes | Works — binary inherits .app's AX trust | `scripts/simulate_copy` uses CGEvent from its own process. Being inside the .app bundle, macOS treats it as part of the trusted app. Fallback to osascript if binary fails. |
| 6 | **"Copy first, then ⇧⌘S" hint** | Rejected at design stage | N/A | Terrible UX. Extra manual step kills a capture tool. |
| 7 | **Read clipboard only (no ⌘C, no AX)** | First implementation | Only captures what's already in clipboard, not what's selected | User selects text but hasn't copied it → nothing captured. Useless. |

### What we tried and rejected for the overlay:

| # | Approach | Tested? | Result | Why rejected |
|---|----------|---------|--------|-------------|
| 1 | **No overlay — direct capture with toast in panel** | First implementation | Panel had to auto-show, broke multi-app workflow | PRD says panel is for review phase, not capture phase |
| 2 | **Overlay with `transparent: true`** in tauri.conf.json | Yes, 2+ hours debugging | Window existed per Tauri API but was invisible on screen | macOS WKWebView transparent + dark wallpaper = nothing renders. Burned hours on this. |
| 3 | **Overlay with solid background** `#1a1a2e` | Yes ✅ SHIPPED | Visible, reliable | Border + shadow for visibility on any wallpaper |
| 4 | **Three separate hotkeys** (⌥⌘C text, ⌥⌘S screenshot, ⌥⌘R panel) | First implementation | Working but user had to remember 3 hotkeys | Cognitive load. User must decide mode before pressing. |
| 5 | **Single hotkey → interactive overlay (user picks text vs screenshot)** | Built | Extra click to choose mode | Loom gets away with it (sustained recording). Our capture is instant — extra click is friction. |
| 6 | **Single hotkey → auto-detect** ✅ SHIPPED | Yes | Smart, zero decisions | Compare clipboard before/after ⌘C. Changed = text selected → auto-clip. Unchanged = no selection → screenshot mode. User never picks. |
| 7 | **Auto-show panel after capture** | First implementation | Panel popping up breaks focus | User is in Arc researching. Panel appearing = context switch. Killed it. |
| 8 | **Blur-to-hide panel** | Built | Contradicts PRD multi-app capture flow | PRD §4.2: panel must survive app switches for multi-app workflow. |
| 9 | **Tray icon left-click toggles panel** | Built | User complained — panel popped up when opening menu | Menu is for intentional actions. Click = open menu, not surprise panel. |

---

## 4. Crash History & Fixes

| Crash | Root Cause | Fix | Rule |
|-------|-----------|-----|------|
| **SIGABRT on screenshot** (thread 0, `_eprint`) | `eprintln!()` panics when stderr unavailable. macOS GUI apps from Finder have no stderr. | Replaced all `eprintln!`/`println!` with `dbg()` file logger → `/tmp/ri-debug.log` | **NEVER use eprintln!/println! in Tauri commands.** |
| **SIGABRT on launch** (`did_finish_launching`) | `"windows": []` empty array + tray config. Tauri v2 crashes on empty windows. | Always define at least one window in tauri.conf.json | Check windows array before deploy |
| **Global shortcuts register but never fire** | macOS Accessibility permission not granted (or reset by `tccutil reset` during debugging) | Added onboarding flow + `check_accessibility` + `open_accessibility_settings` commands | Hotkeys REQUIRE Accessibility. Tray menu works without it. |
| **Overlay window invisible** | `transparent: true` in tauri.conf.json | Removed transparency, solid `#1a1a2e` background | Don't use transparent windows on macOS without thorough testing |

---

## 5. Source App Detection

**File:** `src-tauri/src/source_detect.rs`
**How:** Two `osascript` calls to System Events:
1. `get name of first application process whose frontmost is true` → app name
2. `get title of front window of first application process whose frontmost is true` → window title

**When:** Called in `do_capture_flow()` BEFORE ⌘C simulation. Critical timing — after ⌘C, our app or the overlay may have focus.

**URL extraction:** `extract_url_from_title(title, app_name)` parses browser window titles. Checks if app is a known browser (Chrome, Arc, Safari, Firefox, Edge, Brave, Opera, Vivaldi), then:
1. Looks for `http://` or `https://` words in title
2. Falls back to `" - "` splitting, checks last segments for domain patterns (contains `.`, no spaces, length > 3)

**Limitation:** Heuristic. Not all browsers show URL in title. Arc shows page title only. Phase 1: optional browser extension.

---

## 6. OCR Pipeline

**File:** `src-tauri/scripts/ocr.swift` (compiled to `scripts/ocr`)

**Flow:** `screencapture -i {path}` → `scripts/ocr {path}` → stdout = OCR text

**Languages:** en, ru, de, fr, es, zh-Hans (Apple Vision `recognitionLanguages`)
**Recognition level:** `.accurate` with language correction enabled
**Binary locations (checked in order):**
1. `.app/Contents/Resources/scripts/ocr` (production bundle)
2. `{exe_dir}/ocr` (next to binary)
3. `CARGO_MANIFEST_DIR/scripts/ocr` (development)

**Also bundled:**
- `scripts/get_selected_text` — AX text reader (not used in current flow, kept for Phase 1)
- `scripts/simulate_copy` — CGEvent ⌘C simulator. Runs as separate process inheriting .app's AX trust. Used instead of in-process CGEvent (which doesn't deliver cross-process) or osascript (which is a separate untrusted binary).
- `scripts/clipboard_read` — Reads full clipboard: text + image data. Outputs JSON `{text, image_path}`. Saves clipboard images (PNG/TIFF) to `~/.research-inbox/images/`. Replaces `pbpaste` which only reads plain text.

**Rich clipboard capture (2026-03-30):** When user copies content with images (web pages, Telegram, Word), `clipboard_read` extracts both the text AND the image. Image is saved as PNG, text + `[Image: /path]` reference stored as the capture content. The item card shows the image inline.

---

## 7. Database Schema

**File:** `src-tauri/src/db.rs`
**Location:** `~/.research-inbox/data.db`
**Mode:** WAL (`PRAGMA journal_mode=WAL`)

```sql
-- Main captures
CREATE TABLE items (
  id TEXT PRIMARY KEY,           -- UUID v4
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'image'
  source_app TEXT NOT NULL DEFAULT 'Unknown',
  source_url TEXT,               -- NULL for non-browser apps
  source_title TEXT,             -- window title
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  char_count INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,  -- 0/1
  created_at TEXT NOT NULL,      -- ISO 8601
  updated_at TEXT NOT NULL       -- ISO 8601
);

-- FTS5 (auto-synced via triggers on insert/update/delete)
CREATE VIRTUAL TABLE items_fts USING fts5(
  content, source_app, source_title, tags,
  content='items', content_rowid='rowid'
);

-- Tag autocomplete + frequency
CREATE TABLE tags (
  name TEXT PRIMARY KEY,
  use_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL,
  color_index INTEGER NOT NULL DEFAULT 0  -- 0-7, deterministic hash
);

-- Context Packs
CREATE TABLE packs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,              -- TL;DR
  constraints_text TEXT,         -- "Constraints & Decisions" section
  questions TEXT,                -- "Questions for AI" section
  item_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of item UUIDs (ordered)
  export_format TEXT NOT NULL DEFAULT 'markdown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- App settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Indexes:** `idx_items_created_at` (DESC), `idx_items_is_archived`, `idx_items_source_app`, `idx_tags_use_count` (DESC).

**Images:** `~/.research-inbox/images/{uuid}.png`

---

## 8. IPC Command Registry

21 Tauri commands registered in `lib.rs::invoke_handler`. All defined in `commands.rs`.

| Command | Purpose | Called from |
|---------|---------|-----------|
| `capture_item` | Save text capture to DB | Overlay (capture-triggered event handler) |
| `capture_screenshot` | Run screencapture + OCR + save to DB | Overlay (screenshot flow) |
| `check_duplicate` | Check if content exists in last 100 items | Overlay (before saving) |
| `list_items` | Paginated item listing with filters | Panel (InboxPanel), Overlay (recent list) |
| `search_items` | FTS5 search with prefix parsing (#tag, from:app, today, this-week) | Panel (SearchBar) |
| `update_item` | Update content, tags, or archive status | Panel (ItemCard) |
| `delete_item` | Permanent delete | Panel (ItemCard) |
| `list_tags` | Autocomplete with prefix matching | Panel (TagInput) |
| `create_pack` | Create Context Pack | Panel (PackEditor) |
| `update_pack` | Update pack fields | Panel (PackEditor) |
| `list_packs` | List saved packs | Panel (PacksList) |
| `export_pack` | Generate formatted pack string | Panel (PackEditor) |
| `delete_pack` | Delete pack | Panel (PacksList) |
| `get_settings` | Read all settings | Panel (App.tsx) |
| `update_settings` | Write all settings | Panel (Settings) |
| `get_foreground_app_cmd` | Get current foreground app info | Panel (legacy, used by Clip button in header) |
| `check_accessibility` | Check if AX permission granted | Panel (Onboarding) |
| `open_accessibility_settings` | Open System Settings → Accessibility | Panel (Onboarding) |
| `refocus_app` | Activate an app by name via osascript | Overlay (auto-dismiss refocus) |
| `trigger_text_capture` | Detect foreground app + emit capture event | Panel (Clip button), Overlay (Clip button) |
| `trigger_screenshot_capture` | Emit screenshot event | Panel (Screen button) |

---

## 9. Event Names (Rust ↔ Frontend)

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `capture-triggered` | Rust → Both windows | JSON: `{app_name, window_title, url_from_title, selected_text}` | Text was captured, save it |
| `screenshot-activate` | Rust → Overlay | None | No text found, activate screenshot mode |

Both events are emitted from `lib.rs::do_capture_flow()`. Both windows (panel + overlay) can listen, but only the overlay acts on them in practice.

---

## 10. Context Pack Export Formats

4 formats in `commands.rs::format_pack()`:

| Format | Target | Key structure |
|--------|--------|--------------|
| `markdown` | Human reading, Cursor project context | `# Title` → `> TL;DR` → `## Evidence` → `### N. Source – Time` → `## Constraints` → `## Questions` |
| `claude` | Claude (Anthropic) | `<context>` → `<title>` → `<summary>` → `<evidence>` → `<item source="" date="">` → `<constraints>` → `<questions>` |
| `chatgpt` | ChatGPT (OpenAI) | `# Context Pack: Title` → `**Summary:**` → numbered items → `**Constraints:**` → `**Questions:**` |
| `cursor` | Cursor IDE (.cursorrules) | `# Project Context: Title` → `## Background` → `## Research Evidence` (bullet list) → `## Constraints` → `## Open Questions` |

Helper functions: `fmt_time(iso) → "Mar 28, 12:44"`, `fmt_source(app, url, title) → "App | URL | Title"` (omits empty fields).

---

## 11. Onboarding Flow

**File:** `src/components/Onboarding.tsx`
**Gate:** `localStorage.getItem("ri-onboarded")` — if not `"true"`, shows onboarding instead of inbox.
**Reset:** `rm -rf ~/Library/WebKit/com.omniboard.research-inbox`

3 screens:

1. **Welcome** — "Capture once. Reuse everywhere." + three value points: ⇧⌘S hotkey, Context Packs as living docs, share with colleagues/present on call/feed to AI. Button: "Set up permissions →"
2. **Accessibility** — step-by-step (Open Settings → find Research Inbox → toggle ON). Auto-polls `check_accessibility` every 2s. Green checkmark when granted. "Skip for now" link. Button: "Open Settings" / "Continue →"
3. **Done** — ⇧⌘S shown as large kbd element. Button: "Start capturing"

---

## 12. Tray Menu (current)

```
Capture  ⇧⌘S         → do_capture_flow()
──────────────────
Open Inbox            → toggle_panel()
──────────────────
Quit Research Inbox   → app.exit(0)
```

Tray icon left-click: opens menu dropdown only. Does NOT toggle panel.

---

## 13. Overlay States

**File:** `src/components/CaptureOverlay.tsx`
**State type:** `OverlayState` discriminated union.

| State | Trigger | UI | Auto-dismiss |
|-------|---------|-----|-------------|
| `idle` | Initial / after dismiss | Nothing visible (window hidden) | N/A |
| `success` (kind: `"text"`) | Text captured via ⌘C detect | ✓ icon + "Saved to Research Inbox" + `source — "preview..."` + shrinking green progress bar | 4s → hide → `refocus_app(source)` |
| `success` (kind: `"screenshot"`) | Screenshot + OCR completed | Camera icon + "Screenshot saved" + `source — "OCR preview..."` + progress bar | 4s → hide → `refocus_app(source)` |
| `screenshotting` | No text detected, screenshot activating | Pulsing blue camera icon + "Select screen region..." | No — waits for screencapture to finish or Esc |
| `interactive` | Screenshot cancelled by user (Esc) | `Clip Text` button + `Screenshot` button + `✕` close | No — user picks next action |

**CSS animation:** `@keyframes shrink { from { width: 100% } to { width: 0% } }` — 4s linear, applied to progress bar div inside success state.

---

## 14. Test Coverage

27 Rust unit tests. Run: `cd src-tauri && cargo test`

| Area | Tests | What's covered |
|------|-------|---------------|
| Source URL extraction | 5 | Chrome domain, Arc domain, HTTPS URL, non-browser (returns None), plain title |
| Timestamp formatting | 3 | Standard ISO, single-digit day, edge cases (empty, short) |
| Source line formatting | 3 | Full (app+url+title), no URL, empty URL |
| Tag colors | 2 | Range 0-7, deterministic (same tag → same color) |
| Pack export formats | 5 | Markdown, Claude XML, ChatGPT, Cursor, empty title fallback |
| DB operations | 3 | Init + insert, tags upsert (use_count increments), packs CRUD (insert + query + delete) |
| FTS5 sync | 3 | Search works after insert, FTS updates on content change, FTS cleans up on delete |
| Dedup | 2 | Detects duplicate, archived items excluded from dedup check |
| Settings | 1 | Insert + upsert (key conflict) |
| Ordering | 1 | Multiple items returned newest-first |

---

## 15. Files That Matter

| File | What it does | Break risk |
|------|-------------|-----------|
| `src-tauri/src/lib.rs` | App setup, ⇧⌘S registration, `do_capture_flow()`, `get_clipboard_text()`, overlay/panel toggle, `dbg()` logger | **CRITICAL** |
| `src-tauri/src/commands.rs` | 21 IPC handlers: capture, search, packs, settings, AX check, refocus | **CRITICAL** |
| `src-tauri/src/source_detect.rs` | Foreground app detection + URL extraction from titles | MEDIUM |
| `src-tauri/src/db.rs` | SQLite init, schema, FTS5 triggers | **HIGH** — schema changes need migration |
| `src-tauri/src/models.rs` | Rust structs: CaptureItem, Tag, ContextPack, AppInfo, AppSettings | HIGH |
| `src-tauri/tauri.conf.json` | Window definitions (panel + overlay), bundle resources, CSP | **HIGH** — wrong config = crash |
| `src-tauri/capabilities/default.json` | Permission grants per window label | **HIGH** — missing label = silent IPC failure |
| `src/components/CaptureOverlay.tsx` | Overlay state machine (idle/success/screenshotting/interactive) | **CRITICAL** |
| `src/App.tsx` | Main panel app: event listeners for capture-triggered, onboarding gate, view routing | HIGH |
| `src/components/InboxPanel.tsx` | Inbox list, search, filters, Clip/Screen buttons in header | HIGH |
| `src/components/Onboarding.tsx` | First-launch permission setup (3 screens) | MEDIUM |
| `src/components/ItemCard.tsx` | Item display with source app badge, expand, tags, context menu | MEDIUM |
| `overlay.html` | Overlay entry point. Must have `background: #1a1a2e` in style tag. | MEDIUM |
| `src/overlay.tsx` | Overlay React entry point | LOW |
| `src-tauri/scripts/ocr.swift` | Vision framework OCR binary source | LOW (rarely changes) |
| `src-tauri/scripts/get_selected_text.swift` | AX API text reader binary source (bundled, not used in current flow) | LOW |
| `vite.config.ts` | Multi-page build: main (index.html) + overlay (overlay.html) | MEDIUM |

---

## 16. Known Limitations (Phase 0)

1. **Hotkeys require Accessibility permission** — no workaround on macOS. Tray menu works without it. Onboarding guides the user.
2. **⌘C simulation overwrites clipboard** — intentional design decision (see §3 table). User selected the text; it belongs in clipboard. One clipboard event, no restore.
3. **Source URL from browsers is heuristic** — window title parsing. Arc doesn't show URL in title at all. Phase 1: optional browser extension.
4. **No encryption** — plain SQLite for alpha. SQLCipher in Phase 0.5 before public launch.
5. **macOS only** — Windows build not tested. Rust code has `#[cfg(target_os = "macos")]` guards for osascript calls and screencapture. Windows equivalents: `Get-Process` for foreground app, Snipping Tool API for screenshots.
6. **No auto-update** — user re-installs DMG manually. Consider Sparkle or tauri-plugin-updater for Phase 0.5.
7. **`beforeBuildCommand` path sensitivity** — `cargo tauri build` must run from the project root (where package.json lives), not from `src-tauri/`. Otherwise `npm run build` fails with `vite: command not found`.
8. **Overlay rendering** — solid `#1a1a2e` background. Previously tried transparent background — invisible on dark wallpapers. Don't re-introduce transparency without testing on multiple wallpapers.

---

## 17. ⌘C Simulation: The Full Journey

Getting ⌘C to work from our process to copy selected text in OTHER apps was the hardest technical problem. Every approach we tried:

| # | Approach | Tested | Result | Why rejected/accepted |
|---|----------|--------|--------|----------------------|
| 1 | **AXSelectedText via osascript** | Yes | Slow (~500ms), doesn't work in Arc/Electron | AppleScript overhead. Chromium apps don't expose AXSelectedText. |
| 2 | **AXSelectedText via compiled Swift binary** (`get_selected_text.swift`) | Yes | Fast (~10ms) but fails in Chromium/Electron | Same AX limitation, faster execution doesn't help if the API doesn't work. Binary is bundled but unused. |
| 3 | **⌘C via osascript** (`keystroke "c" using command down`) | Yes | **Fails** — "osascript is not allowed to send keystrokes" | osascript is a SEPARATE PROCESS. Even though our app has Accessibility, the spawned osascript binary does NOT inherit it. |
| 4 | **⌘C via compiled Swift binary** (`simulate_copy`) using CGEvent | Yes | Exit 0 but clipboard unchanged | Same problem — separate process, separate AX trust. macOS tracks permissions per-binary, not per-bundle. |
| 5 | **⌘C via in-process Rust CGEvent FFI** (source state 0, HID tap 0) | Yes | CGEvent created and posted, but NOT delivered to target app | Source state `CombinedSessionState` (0) + HID tap doesn't deliver keyboard events cross-process. |
| 6 | **⌘C via in-process Rust CGEvent FFI** (source state 0, session tap 1) | Yes | Same — clipboard doesn't change | Session tap also doesn't work with `CombinedSessionState`. |
| 7 | **⌘C via in-process Rust CGEvent FFI** (source state 1 `HIDSystemState`, HID tap 0) ✅ SHIPPED | Yes | **WORKS** — but requires BOTH Accessibility AND Input Monitoring | `CGEventSourceCreate(1)` + `CGEventPost(0, event)`. This is what Maccy uses internally. Requires user to grant Input Monitoring permission in addition to Accessibility. |
| 8 | **⌘C + clipboard restore** | Tested in code | Works but double clipboard event | Clipboard managers catch the restore as a second event. Rejected — one clean event is better. |
| 9 | **"Copy first" UX (no simulation)** | Rejected at design | N/A | User selects text and expects one hotkey to capture. Extra ⌘C step = death for capture tool UX. |

**Key insight:** macOS has TWO separate permissions for keyboard event handling:
- **Accessibility** — allows global shortcuts, reading UI elements
- **Input Monitoring** — allows POSTING keyboard events to other apps via CGEvent

Both are required. Both must be granted by the user in System Settings. The onboarding guides through both.

**Key insight 2:** CGEvent source state matters. `CombinedSessionState` (0) doesn't work for cross-process key posting. `HIDSystemState` (1) does.

---

## 18. Rich Clipboard: Text + Images

When user copies text+images from a webpage (e.g., Bandcamp page with album art), the clipboard contains:
- `public.utf8-plain-text` — plain text only (no images)
- `public.html` — HTML with `<img src="...">` tags
- Optionally: `public.png` / `public.tiff` — raw image data (only if user copied a single image)

**Approach:** `clipboard_read.swift` binary reads all three. For web selections:
1. Extracts `<img src="...">` from HTML clipboard
2. Downloads images from URLs (max 5, skip <1KB tracking pixels)
3. Converts to PNG, saves to `~/.research-inbox/images/{uuid}.png`
4. Returns JSON: `{"text": "...", "image_paths": ["/path1.png", ...]}`

| Source | How images arrive | Our handling |
|--------|------------------|-------------|
| Screenshot (`screencapture -i`) | Raw PNG file on disk | Direct save + OCR |
| Copy image from browser | `public.png` on clipboard | `clipboard_read` extracts raw PNG |
| Copy text+images from webpage | `public.html` with `<img>` tags | `clipboard_read` parses HTML, downloads images |
| Copy from Figma/Sketch | `public.tiff` on clipboard | `clipboard_read` converts TIFF→PNG |

**Frontend rendering:** `ItemCard.tsx` parses `[Image: /path]` references from content, renders them as `<img src="asset://localhost/path">` thumbnails (40×40 collapsed, 200×150 expanded). Uses Tauri's `protocol-asset` feature for local file access from webview.

---

## 19. macOS Permission Dance (Alpha Pain)

**Problem:** Ad-hoc signed apps (no Apple Developer certificate) get a new CDHash on every build. macOS uses CDHash to track permissions. Every rebuild invalidates Accessibility + Input Monitoring grants.

**Workaround during dev:** After `cargo tauri build` + DMG install, re-sign with stable identifier:
```bash
codesign --force --deep --sign - --identifier "com.omniboard.research-inbox" "/Applications/Research Inbox.app"
```
This doesn't fully fix it — CDHash still changes per compilation. User must re-toggle permissions after each install.

**Fix for beta/production:** Apple Developer certificate ($99/year). Stable team ID → stable CDHash → permissions persist across updates.

**Onboarding updated** to guide through BOTH permissions:
- Step 1: Accessibility (Open Settings → find → toggle ON)
- Step 2: Input Monitoring (Open Settings → click + → add from /Applications → toggle ON)
- "I've enabled both →" button (no auto-skip)

---

## 20. Menu Bar Icon

**Problem:** After `codesign --force --deep`, the icon becomes a blank square. The re-signing process may strip or invalidate the icon resource.

**Status:** Needs fix. The icon is defined in `tauri.conf.json` bundle.icon and set via `TrayIconBuilder::icon(app.default_window_icon())` with `.icon_as_template(true)`.

---

## 21. Context Pack v2: AI-Powered Document Generation (Decision 2026-03-30, revised 2026-04-02)

**Problem:** Context Packs are raw data dumps. Users can't defend ideas, share with colleagues, or get precision from AI agents with them.

**Research:** 5 parallel deep research agents analyzed: local LLMs (15+ models benchmarked), subscription reuse (Claude/ChatGPT/Cursor/Copilot), document design (McKinsey/Amazon/Minto frameworks), desktop AI implementations (Pieces/Raycast/Obsidian), MCP protocol. Follow-up research (2026-04-02): distilled model analysis (Jackrong Qwopus/Claude-distilled models), corporate laptop RAM survey, free API data training policies, MCP risk assessment.

### Revised decision — three-tier architecture (updated 2026-04-02):

| Priority | Path | How | When |
|----------|------|-----|------|
| 1 (PRIMARY) | **Paid Cloud API** | Claude Haiku or Qwen cloud endpoint. In-app "Generate Document" button. 2-5 sec generation. User's data NOT used for training (paid API TOS). | Phase 0.5 |
| 2 (SECONDARY) | **MCP Server** | Power-user feature. We expose tools to Claude Desktop/Cursor. User's subscription, zero cost to us. UX is 6+ steps vs 2 for built-in — secondary, not primary. | Phase 1 |
| 3 (FALLBACK) | **Local Model** | Qwen 3.5 9B Q4 (5.6GB, fits 16GB comfortably). Offline/privacy users. ~3 min on M1, ~8 min on ThinkPad DDR4. Qwen 2.5 7B Q4 (4.4GB) as 8GB-device fallback. | Phase 2 |

### Why the strategy changed (2026-04-02):

**Free cloud API rejected:**
- Gemini free tier, DeepSeek free credits: data used for model training. Unacceptable for clipboard data containing meeting notes, strategy docs, competitive intel.
- Groq free tier: doesn't train models but limited model selection, uncertain long-term policy.

**MCP demoted from primary to secondary:**
- UX is 6+ steps (open Claude Desktop → type prompt → wait → copy back) vs 2 steps (click Generate → review)
- No quality control — user's prompt determines output quality, not our template
- No revenue path — user's subscription, not our feature
- MCP sampling (which would allow us to call the LLM) is not implemented in Claude Desktop, no timeline from Anthropic
- Still valuable as power-user integration for Claude Desktop/Cursor users

**Local model upgraded from 3B to 9B:**
- Laptop research (2026-04-02) shows 16GB is the corporate baseline: Russia B2B 2024 = 56% 16GB, 40% 8GB. Global trend confirms 16GB standard for new business laptops.
- MBB (McKinsey/BCG/Bain) = ThinkPad X1 Carbon (16GB). Big Four = Dell Latitude/HP EliteBook (16GB).
- 8GB is a shrinking tail (~20-30% of knowledge workers in 2025, <15% by 2027).
- 9B Q4 (5.6GB) fits 16GB with ~4GB headroom. 7B Q4 (4.4GB) as fallback for 8GB minority.

**Jackrong distilled models (Qwopus3.5-9B, Claude-Opus-Reasoning-Distilled) rejected:**
- Legal risk: Anthropic TOS explicitly prohibits using Claude outputs to train competing models. Anthropic sued DeepSeek/Moonshot/MiniMax in Feb 2026 for exactly this.
- Solo creator dependency (Jackrong, 153 models, could be DMCA'd)
- Writing quality unproven (benchmarked on math/code, not document generation)
- Russian language may degrade (SFT data is English-reasoning-focused)
- Use official Qwen models (Apache 2.0, Alibaba-backed, no legal risk)

### Model recommendation:

| Target | Model | Size Q4 | RAM needed | Speed | Quality |
|--------|-------|---------|-----------|-------|---------|
| 16GB (majority) | Qwen 3.5 9B Instruct | 5.6 GB | ~6.5 GB | M1: 10-12 t/s, ThinkPad: 3-5 t/s | Good for structured docs |
| 8GB (minority) | Qwen 2.5 7B Instruct | 4.4 GB | ~5.2 GB | M1: 14-18 t/s, ThinkPad: 5-7 t/s | Acceptable |
| Any (primary) | Cloud API (Claude Haiku) | N/A | N/A | 2-5 sec | Best |

**Document format:** YAML frontmatter + SCQA narrative + structured evidence with source badges + assumptions/risks + counter-arguments + action items. AI generates structure, humans own recommendations.

**What we rejected:**
- Free cloud APIs (Gemini/DeepSeek train on data, unacceptable for clipboard content)
- BYOK (users hate API keys, corporate users can't share them)
- Jackrong/Claude-distilled models (Anthropic TOS violation, legal risk)
- MCP sampling (not implemented in Claude Desktop, no timeline)
- Automating ChatGPT/Claude UI (TOS violation, fragile)
- Browser session tokens (TOS violation, security risk)
- Our own API proxy (server costs, maintenance — but may need light proxy for paid API key management)
- Large local models 13B+ (doesn't fit even 16GB comfortably with PM workload)
- WebLLM in-browser (WebGPU not in WKWebView)

---

*Last updated: 2026-04-02 — revised Context Pack v2 strategy: free API rejected (training), MCP demoted to secondary, local model upgraded to 9B based on laptop RAM research*

---

## v2 Architecture: AI Context Engine (2026-04-12)

### What changed

Upgraded from clipboard capture tool (v0) to AI-powered context engine. All changes on `feat/v2-ai-context-engine` branch.

### Stack additions

| Component | Choice | Why |
|-----------|--------|-----|
| AI model | Gemma 4 2B Q4_K_M (~1.5GB GGUF) | Small enough for any modern machine, capable enough for classification/tagging/summarization |
| AI runtime | llama.cpp sidecar (planned) | Battle-tested C++, no Python dependency, stdin/stdout JSON protocol |
| Vector search | JSON embeddings + Rust cosine similarity | Good enough for alpha (<10K items). sqlite-vec deferred – overkill for single-user |
| TTL manager | 5-min idle → kill sidecar, ~150ms warm restart | Serial capture pattern: model stays hot during burst, freed when PM switches to other apps |

### Key invariant

**ALL AI operations are async/non-blocking.** UI speed = SQLite speed. AI = background enrichment ghost. Capture path: item → SQLite → overlay → done. AI enriches later. If any AI call becomes synchronous on the capture path, the product dies.

### New IPC commands

| Command | Purpose |
|---------|---------|
| `enrich_item` | Async enrichment: classify, tag, summarize, embed |
| `semantic_search` | Cosine similarity over 384-dim embeddings |
| `generate_pack` | AI creates pack from natural language intent |
| `chat_pack_agent` | AI modifies existing pack per instruction |
| `get_clusters` | Topic clustering |
| `check_model_status` | Model download check |
| `check_hardware` | RAM gate (8GB minimum) |
| `download_model` | Model download with resume + progress events |

### Design system: Well / Tray

Replaced generic dark/light with rich design language:
- **Well (dark)** – engine room. Black void, inset shadows falling inward, content glows like LEDs. `#050508` base.
- **Tray (light)** – surgical precision. Pale container, white cards float above tray floor. `#F4F4F6` base.
- Tokens in `src/styles/tokens.css`, consumed via CSS custom properties throughout.
- Tag colors: 8 pairs with theme-aware opacity (CSS vars, not Tailwind classes).

### New components

| Component | Replaces | Purpose |
|-----------|----------|---------|
| `AskBar.tsx` | `SearchBar.tsx` | 4-mode bar: Search / Intent / Chat / Ask |
| `PackView.tsx` | — (PackEditor kept for compat) | Pack display + AI chat refinement + export preview |
| `AgentLog.tsx` | — | Collapsible instruction↔response log per pack |
| `ExportPreview.tsx` | — | Read-only live preview, format selector, char/token count |
| `BottomNav.tsx` | inline footer | Stream / Topics / Packs tab bar |
| `TopicsView.tsx` | — | AI-clustered topic cards |
| `ClusterCard.tsx` | — | Individual topic cluster card |

### Schema v2

- `items.enrichment TEXT` – JSON with auto_tags, content_class, entities, summary
- `vec_items (item_id, embedding)` – 384-dim float vectors as JSON
- `clusters (id, title, item_ids, centroid)` – topic clustering
- `packs.meta TEXT` – JSON with audience, tone, purpose
- `packs.agent_log TEXT` – JSON array of chat instruction/response pairs

### Current state (alpha)

AI enrichment uses heuristic rules (keyword classification, entity extraction) and deterministic mock embeddings. When Gemma 4 GGUF + llama.cpp binary are available, only the prompt templates and response parsing change – the pipeline, TTL, sidecar infrastructure are ready.

*Updated: 2026-04-12 — v2 AI Context Engine implementation complete*
