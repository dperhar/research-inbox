import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CaptureItem } from "../types";

type OverlayState =
  | { mode: "idle" }
  | { mode: "success"; kind: "text" | "screenshot"; preview: string; source: string }
  | { mode: "screenshotting" }
  | { mode: "interactive" }; // screenshot cancelled, user picks action

export default function CaptureOverlay() {
  const [state, setState] = useState<OverlayState>({ mode: "idle" });
  const [autoTags, setAutoTags] = useState<string[]>([]);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sourceAppRef = useRef(""); // remember source app for refocus

  const autoDismiss = (source: string) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(async () => {
      getCurrentWindow().hide();
      setState({ mode: "idle" });
      // Refocus source app
      if (source) {
        invoke("refocus_app", { appName: source }).catch(() => {});
      }
    }, 4000);
  };

  // Listen for enrichment result and update tags
  useEffect(() => {
    const unlisten = listen<{ id: string; enrichment: any; tags: string[] }>(
      "item-enriched",
      (event) => {
        setAutoTags(event.payload.tags.filter((t: string) => t.startsWith('#')));
      }
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Text + image capture event from Rust
  useEffect(() => {
    const unlisten = listen<string>("capture-triggered", async (event) => {
      try {
        let appName = "Clipboard";
        let selectedText: string | null = null;
        let imagePaths: string[] = [];

        try {
          if (event.payload) {
            const data = JSON.parse(event.payload);
            appName = data.app_name || "Clipboard";
            selectedText = data.selected_text || null;
            imagePaths = data.image_paths || [];
          }
        } catch {}

        sourceAppRef.current = appName;
        setAutoTags([]);

        // Build content: text + image references
        let content = selectedText || "";
        if (!content.trim()) {
          try { content = (await readText()) || ""; } catch {}
        }

        // Append image references
        if (imagePaths.length > 0) {
          const imgRefs = imagePaths.map((p: string) => `[Image: ${p}]`).join("\n");
          content = content ? `${content}\n\n${imgRefs}` : imgRefs;
        }

        if (!content.trim()) return;
        if (content.length > 50 * 1024) content = content.slice(0, 50 * 1024);

        const isDup = await invoke<boolean>("check_duplicate", { content });
        if (isDup) {
          setState({ mode: "success", kind: "text", preview: "Already saved", source: appName });
          autoDismiss(appName);
          return;
        }

        const item = await invoke<CaptureItem>("capture_item", {
          content,
          sourceApp: appName,
          sourceUrl: null,
          sourceTitle: null,
          tags: [],
        });

        // Fire enrichment in background (don't block UI)
        invoke("enrich_item", { id: item.id }).catch(() => {});

        const hasImages = imagePaths.length > 0;
        const hasText = !!(selectedText && selectedText.trim());
        let preview: string;
        let kind: "text" | "screenshot";
        if (hasText && hasImages) {
          preview = selectedText!.slice(0, 20) + ` + ${imagePaths.length} img`;
          kind = "text";
        } else if (hasImages) {
          preview = `${imagePaths.length} image${imagePaths.length > 1 ? "s" : ""} captured`;
          kind = "screenshot";
        } else {
          preview = content.slice(0, 32);
          kind = "text";
        }

        setState({ mode: "success", kind, preview, source: appName });
        autoDismiss(appName);
      } catch {
        setState({ mode: "interactive" });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Screenshot activation
  useEffect(() => {
    const unlisten = listen("screenshot-activate", async () => {
      // Only screenshot if no text was captured (state is still idle or interactive)
      // Small delay so overlay renders
      await new Promise((r) => setTimeout(r, 400));

      // If text was already captured, don't auto-screenshot
      if (state.mode === "success") return;

      setState({ mode: "screenshotting" });
      await doScreenshot();
    });
    return () => { unlisten.then((f) => f()); };
  }, [state.mode]);

  const doScreenshot = async () => {
    try {
      const item = await invoke<CaptureItem>("capture_screenshot", { tags: [] });
      const preview = item.content.slice(0, 32);
      const source = item.source_app || sourceAppRef.current;
      setState({ mode: "success", kind: "screenshot", preview, source });
      autoDismiss(source);
    } catch (err: any) {
      if (err?.toString().includes("cancelled")) {
        setState({ mode: "interactive" });
      } else {
        setState({ mode: "interactive" });
      }
    }
  };

  const doClip = async () => {
    try {
      await invoke("trigger_text_capture");
    } catch {}
  };

  const handleClose = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    getCurrentWindow().hide();
    setState({ mode: "idle" });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.mode !== "screenshotting") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.mode]);

  // ── Success state: auto-dismissing confirmation ──
  if (state.mode === "success") {
    const icon = state.kind === "text" ? (
      <svg className="w-4 h-4 shrink-0" style={{ color: "var(--signal-success)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    ) : (
      <svg className="w-4 h-4 shrink-0" style={{ color: "var(--signal-success)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
    );

    return (
      <div className="overlay-glass h-full flex items-center select-none px-4 gap-3"
        style={{ borderRadius: "var(--radius-panel)" }}>
        {icon}
        <div className="flex flex-col min-w-0">
          <span className="text-[var(--text-1)] text-[11px] font-medium">
            {state.kind === "text" ? "Saved to Research Inbox" : "Screenshot saved"}
          </span>
          <span className="text-[var(--text-3)] text-[10px] truncate max-w-[280px]">
            {state.source} — "{state.preview}..."
          </span>
        </div>
        {autoTags.length > 0 && (
          <div className="flex gap-1 ml-auto shrink-0">
            {autoTags.slice(0, 3).map((tag, i) => (
              <span
                key={tag}
                style={{
                  background: "var(--accent-muted)",
                  color: "var(--accent)",
                  borderRadius: "var(--radius-tag)",
                  padding: "0 5px",
                  fontSize: "10px",
                  animation: `tagFadeIn 200ms ${i * 200}ms var(--ease-settle) both`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {autoTags.length === 0 && state.mode === "success" && (
          <div className="ml-auto w-16 h-3 rounded shrink-0"
            style={{
              background: "var(--accent-muted)",
              animation: "accentPulse 1.5s var(--ease-mechanical) infinite",
            }}
          />
        )}
        <div className="flex-1" />
        {/* Thin progress bar that shrinks over 4s */}
        <div className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full overflow-hidden">
          <div className="h-full rounded-full"
            style={{ background: "var(--signal-success)", opacity: 0.4, animation: "shrink 4s linear forwards" }} />
        </div>
      </div>
    );
  }

  // ── Screenshotting state: minimal indicator ──
  if (state.mode === "screenshotting") {
    return (
      <div className="overlay-glass h-full flex items-center select-none px-4 gap-2"
        style={{ borderRadius: "var(--radius-panel)" }}>
        <svg className="w-3.5 h-3.5 text-[var(--accent)] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
        <span className="text-[var(--text-2)] text-[11px]">Select screen region...</span>
      </div>
    );
  }

  // ── Interactive state: buttons (screenshot cancelled or idle) ──
  return (
    <div className="overlay-glass h-full flex items-center select-none"
      style={{ borderRadius: "var(--radius-panel)" }}
      data-tauri-drag-region>

      <div className="pl-3" data-tauri-drag-region />

      <button onClick={doClip}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-1)] hover:bg-[var(--surface-card-hover)] active:bg-[var(--surface-card-active)] transition-all text-[11px] font-medium rounded-md">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3a2.25 2.25 0 00-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
        Clip Text
      </button>

      <div className="w-px h-5 bg-[var(--border-default)]" />

      <button onClick={doScreenshot}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-1)] hover:bg-[var(--surface-card-hover)] active:bg-[var(--surface-card-active)] transition-all text-[11px] font-medium rounded-md">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
        Screenshot
      </button>

      <div className="flex-1" data-tauri-drag-region />

      <button onClick={handleClose}
        className="p-1.5 pr-3 text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
