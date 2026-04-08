# Research Inbox

Desktop-first research capture tool for product people. Clip anything from any app into a searchable feed, then package it as a Context Pack – structured context you can hand to AI tools (Claude, Gemini, Cursor, Windsurf), stakeholders, or anyone who needs the full picture instead of another Loom or 40-slide PDF.

## What it does

1. **Capture** – select text in any app, press `Shift+Cmd+S`. Text is saved with source app, timestamp, and URL
2. **Search** – full-text search across all captures via SQLite FTS5
3. **Context Packs** – export structured context (TL;DR, sources, constraints) ready for AI tools, stakeholders, colleagues, agents, or anyone who asks 'why 🤔'

Screenshots and OCR supported – if no text is selected, it captures the screen and runs on-device text recognition.

## Stack

- [Tauri v2](https://v2.tauri.app/) (Rust + WebView)
- React 19 + TypeScript + Vite
- Tailwind CSS v4
- SQLite with FTS5 full-text search
- Apple Vision framework for OCR (macOS)

## Getting started

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) 20+
- macOS (Apple Vision OCR is macOS-only for now)

### Development

```bash
npm install
cargo tauri dev
```

### Build

```bash
cargo tauri build
```

Outputs a `.dmg` in `src-tauri/target/release/bundle/dmg/`.

## Architecture

Two Tauri windows:
- **Panel** (380x560) – main inbox UI with search, tags, and Context Pack editor
- **Overlay** (420x56) – capture confirmation bar, always-on-top

Single hotkey `Shift+Cmd+S` triggers the capture flow: detect foreground app → simulate copy → compare clipboard → save to SQLite.

All data stays local. No account required. No telemetry.

## License

[Business Source License 1.1](LICENSE) – free for non-commercial use. Converts to Apache 2.0 on 2030-04-08.
