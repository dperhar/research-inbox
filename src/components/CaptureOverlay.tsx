import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CaptureItem } from "../types";

// v2.5 capture HUD.
// One surface, one moment: confirm + orient. Three zones — icon · one-line · action.
// Draggable in every visible mode (interactive, success, screenshotting, error) so the
// user can park the HUD anywhere without losing capture confidence.

type ErrorKind = "permission" | "failed" | "empty";

// §3.6 honest states — success/duplicate/screenshotting/error are each their own
// tone and silhouette. Duplicate in particular is NOT a success: the item was
// already in the inbox, nothing fresh happened, and the user should see that
// at a glance instead of a false-positive green checkmark.
type OverlayState =
  | { mode: "idle" }
  | { mode: "interactive" }
  | { mode: "screenshotting" }
  | {
      mode: "success";
      kind: "text" | "screenshot";
      detail: string;
      source: string;
      imageCount: number;
      imagePath?: string;
    }
  | {
      mode: "duplicate";
      source: string;
      detail: string;
      kind: "text" | "screenshot";
    }
  | { mode: "error"; kind: ErrorKind; message?: string };

function squeezeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMediaRefs(content: string) {
  return content.replace(/\n*\[(?:Image|Screenshot): [^\]]+\]/g, "").trim();
}

function truncatePreview(value: string, maxLength = 80) {
  const cleaned = squeezeWhitespace(value).replace(/^["“]+|["”]+$/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSourceLabel(source: string, fallback = "") {
  const candidate = squeezeWhitespace(source || "");
  const backup = squeezeWhitespace(fallback || "");
  const lower = candidate.toLowerCase();

  if (!candidate && backup) return backup;
  if (!candidate) return "Current app";
  if (lower === "app" || lower === "application" || lower === "unknown") {
    return backup || "Current app";
  }
  return candidate;
}

// ── Iconography ─────────────────────────────────────────────────────────────

const ICON_CLS = "h-4 w-4";

function CameraIcon({ className = ICON_CLS }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
    </svg>
  );
}

function ClipboardIcon({ className = ICON_CLS }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3a2.25 2.25 0 00-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function CheckIcon({ className = ICON_CLS }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function AlertIcon({ className = ICON_CLS }: { className?: string }) {
  // Filled triangle with exclamation — reads "blocked" at a glance, not "success".
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3.3c.85 0 1.64.44 2.08 1.16l8.42 14.3A2.43 2.43 0 0120.42 22H3.58a2.43 2.43 0 01-2.08-3.24L9.92 4.46A2.42 2.42 0 0112 3.3zm0 4.7a1 1 0 00-1 1v4.5a1 1 0 002 0V9a1 1 0 00-1-1zm0 9.25a1.15 1.15 0 100 2.3 1.15 1.15 0 000-2.3z" />
    </svg>
  );
}

function EmptyIcon({ className = ICON_CLS }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    </svg>
  );
}

function InfoIcon({ className = ICON_CLS }: { className?: string }) {
  // Duplicate/already-captured glyph. Distinct from success (check) and error
  // (alert triangle) so §3.6 honest states reads right at first glance.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 4.4a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6zm1.4 11.3a1 1 0 01-2 0v-6a1 1 0 012 0v6z" />
    </svg>
  );
}

function CloseIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

function OverlayShell({
  children,
  dataState,
}: {
  children: React.ReactNode;
  dataState?:
    | "idle"
    | "interactive"
    | "success"
    | "duplicate"
    | "screenshotting"
    | "error";
}) {
  // Entire shell is a drag region so the HUD stays placeable in every mode.
  // Interactive controls use data-no-drag + stopPropagation to avoid accidental drags.
  return (
    <div
      data-tauri-drag-region
      data-state={dataState}
      className="overlay-glass relative h-full overflow-hidden select-none"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {children}
    </div>
  );
}

// Prevents data-tauri-drag-region from hijacking mousedown on interactive controls.
const noDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

// ── Position persistence (§4.2 mobility) ────────────────────────────────────
// Write through to Rust so the next `do_capture_flow` can read the position
// before the window becomes visible. Skips noisy writes during initial hide/show.

async function persistOverlayPosition() {
  try {
    const win = getCurrentWindow();
    const visible = await win.isVisible();
    if (!visible) return;
    const pos = await win.outerPosition();
    const scale = await win.scaleFactor();
    await invoke("save_window_position", {
      label: "overlay",
      x: pos.x / scale,
      y: pos.y / scale,
    });
  } catch {}
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CaptureOverlay() {
  const [state, setState] = useState<OverlayState>({ mode: "idle" });
  const [autoTags, setAutoTags] = useState<string[]>([]);
  // Tracks whether the screenshot thumbnail asset failed to load. When true,
  // the success render falls back to the camera-icon slot instead of leaving a
  // dead thumbnail frame with just a floating check badge.
  const [thumbFailed, setThumbFailed] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sourceAppRef = useRef("");
  const activeItemIdRef = useRef<string | null>(null);
  const lastActionRef = useRef<"text" | "screenshot" | null>(null);

  // Reset thumb-failed flag whenever a new state is entered so a previous
  // failure doesn't poison the next capture's render.
  useEffect(() => {
    if (state.mode !== "success") return;
    setThumbFailed(false);
  }, [state]);

  // Save position whenever overlay becomes hidden. Quiet, honest persistence.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onMoved(() => {
      void persistOverlayPosition();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const autoDismiss = (source: string) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(async () => {
      void persistOverlayPosition();
      getCurrentWindow().hide();
      setState({ mode: "idle" });
      if (source) {
        invoke("refocus_app", { appName: source }).catch(() => {});
      }
    }, 4000);
  };

  // Delayed AI tags land as reinforcement, not a competing banner.
  useEffect(() => {
    const unlisten = listen<{ id: string; enrichment: unknown; tags: string[] }>(
      "item-enriched",
      (event) => {
        if (event.payload.id !== activeItemIdRef.current) return;
        setAutoTags(event.payload.tags.filter((tag: string) => tag.startsWith("#")));
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Rust-emitted blocked states: permission denied, capture failed, nothing selected.
  useEffect(() => {
    const unlisten = listen<{ kind: ErrorKind; message?: string }>("capture-error", (event) => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      activeItemIdRef.current = null;
      const payload = event.payload;
      setState({ mode: "error", kind: payload.kind, message: payload.message });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Primary capture flow.
  useEffect(() => {
    const unlisten = listen<string>("capture-triggered", async (event) => {
      try {
        let appName = "Clipboard";
        let selectedText: string | null = null;
        let imagePaths: string[] = [];
        let sourceUrl: string | null = null;
        let sourceTitle: string | null = null;

        try {
          if (event.payload) {
            const data = JSON.parse(event.payload);
            appName = data.app_name || "Clipboard";
            selectedText = data.selected_text || null;
            imagePaths = data.image_paths || [];
            sourceUrl = data.url_from_title || null;
            sourceTitle = data.window_title || null;
          }
        } catch {}

        sourceAppRef.current = appName;
        activeItemIdRef.current = null;
        setAutoTags([]);

        let content = selectedText || "";
        if (!content.trim()) {
          try {
            content = (await readText()) || "";
          } catch {}
        }

        if (imagePaths.length > 0) {
          const imgRefs = imagePaths.map((path: string) => `[Image: ${path}]`).join("\n");
          content = content ? `${content}\n\n${imgRefs}` : imgRefs;
        }

        if (!content.trim()) {
          // §4.2 blocked state: nothing to capture.
          setState({ mode: "error", kind: "empty" });
          return;
        }
        if (content.length > 50 * 1024) content = content.slice(0, 50 * 1024);

        const isDup = await invoke<boolean>("check_duplicate", { content });
        if (isDup) {
          const source = normalizeSourceLabel(appName, sourceAppRef.current);
          const dupKind: "text" | "screenshot" =
            imagePaths.length > 0 ? "screenshot" : "text";
          const dupDetail =
            truncatePreview(stripMediaRefs(content), 76) ||
            "Nothing new — this is already in your inbox.";
          setState({ mode: "duplicate", kind: dupKind, source, detail: dupDetail });
          autoDismiss(source);
          return;
        }

        const item = await invoke<CaptureItem>("capture_item", {
          content,
          sourceApp: appName,
          sourceUrl,
          sourceTitle,
          tags: [],
        });

        activeItemIdRef.current = item.id;
        invoke("enrich_item", { id: item.id }).catch(() => {});

        const hasImages = imagePaths.length > 0;
        const hasText = !!(selectedText && selectedText.trim());
        const source = normalizeSourceLabel(appName, sourceAppRef.current);

        let detail = "Captured to Research Inbox.";
        let kind: "text" | "screenshot" = "text";

        if (hasText && hasImages) {
          detail = truncatePreview(selectedText || "", 76) || `${imagePaths.length} images captured.`;
          kind = "text";
        } else if (hasImages) {
          detail = `${imagePaths.length} image${imagePaths.length > 1 ? "s" : ""} captured.`;
          kind = "screenshot";
        } else {
          detail =
            truncatePreview(stripMediaRefs(content), 76) || "Saved to your context stream.";
          kind = "text";
        }

        setState({
          mode: "success",
          kind,
          detail,
          source,
          imageCount: imagePaths.length,
          imagePath: hasImages ? imagePaths[0] : undefined,
        });
        autoDismiss(source);
      } catch {
        setState({ mode: "error", kind: "failed" });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("screenshot-activate", async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (state.mode === "success") return;
      setState({ mode: "screenshotting" });
      await doScreenshot();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [state.mode]);

  const doScreenshot = async () => {
    try {
      lastActionRef.current = "screenshot";
      activeItemIdRef.current = null;
      setAutoTags([]);
      const item = await invoke<CaptureItem>("capture_screenshot", { tags: [] });
      activeItemIdRef.current = item.id;
      const source = normalizeSourceLabel(item.source_app, sourceAppRef.current);
      const ocrPreview = truncatePreview(stripMediaRefs(item.content), 76);
      const detail = ocrPreview || "Image saved from selected screen region.";

      setState({
        mode: "success",
        kind: "screenshot",
        detail,
        source,
        imageCount: 1,
        // Rust stores the image path in source_url for screenshot items.
        // The success chrome uses it as proof (§4.2: "show proof, not generic decorative chrome").
        imagePath: item.source_url || undefined,
      });
      autoDismiss(source);
    } catch (err: any) {
      const raw = (err?.toString() || "").toLowerCase();
      if (raw.includes("permission")) {
        setState({ mode: "error", kind: "permission" });
      } else if (raw.includes("cancel")) {
        // User Esc'd out of screencapture. §3.6 honest states: don't pivot to a
        // state the user didn't ask for — hide cleanly.
        handleClose();
      } else {
        setState({ mode: "error", kind: "failed", message: err?.toString?.() });
      }
    }
  };

  const doClip = async () => {
    try {
      lastActionRef.current = "text";
      await invoke("trigger_text_capture");
    } catch {
      activeItemIdRef.current = null;
      setState({ mode: "error", kind: "failed" });
    }
  };

  const handleClose = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    activeItemIdRef.current = null;
    setAutoTags([]);
    void persistOverlayPosition();
    getCurrentWindow().hide();
    setState({ mode: "idle" });
  };

  const retryLastAction = () => {
    if (lastActionRef.current === "text") {
      void doClip();
      return;
    }
    void invoke("trigger_screenshot_capture").catch(() => {
      setState({ mode: "error", kind: "failed" });
    });
  };

  const openScreenCaptureSettings = () => {
    invoke("open_screen_capture_settings").catch(() => {});
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.mode !== "screenshotting") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.mode]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const dragGrip = (
    <span
      aria-hidden
      className="drag-grip"
      style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)" }}
    />
  );

  const quietClose = (
    <button
      {...noDrag}
      onClick={handleClose}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ color: "var(--text-3)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-3)";
      }}
      title="Close"
    >
      <CloseIcon />
    </button>
  );

  // ── SUCCESS ───────────────────────────────────────────────────────────────

  if (state.mode === "success") {
    const headline = state.kind === "text" ? "Saved to Research Inbox" : "Screenshot saved";
    const hasTags = autoTags.length > 0;
    const showThumb =
      state.kind === "screenshot" && !!state.imagePath && !thumbFailed;

    return (
      <OverlayShell dataState="success">
        {dragGrip}
        <div className="relative flex h-full items-center gap-3 px-3.5 pt-1">
          {showThumb ? (
            // §4.2: screenshot success must show proof, not generic decorative chrome.
            // The captured image is the proof — render it inline at the icon slot size.
            <div
              className="relative flex h-9 w-9 shrink-0 overflow-hidden rounded-[10px]"
              style={{
                border: "1px solid var(--border-default)",
                background: "rgba(255,255,255,0.02)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <img
                src={`asset://localhost/${state.imagePath}`}
                alt=""
                className="h-full w-full object-cover"
                onError={() => {
                  // Asset proto couldn't load the image (still being written,
                  // out-of-scope, or bundle path mismatch). Swap the whole slot
                  // to the camera-icon fallback so the check-badge doesn't dangle
                  // over an empty frame — keeps §4.2 "show proof" honest.
                  setThumbFailed(true);
                }}
              />
              <span
                className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full"
                style={{
                  background: "var(--signal-success)",
                  color: "#0a0a10",
                  boxShadow: "0 0 0 2px var(--overlay-bg)",
                }}
                aria-hidden
              >
                <CheckIcon className="h-2.5 w-2.5" />
              </span>
            </div>
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
              style={{
                background:
                  state.kind === "text"
                    ? "rgba(52,211,153,0.12)"
                    : "rgba(45,212,191,0.12)",
                color:
                  state.kind === "text"
                    ? "var(--signal-success)"
                    : "var(--accent-hover)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {state.kind === "text" ? (
                <CheckIcon className="h-[17px] w-[17px]" />
              ) : (
                <CameraIcon className="h-[17px] w-[17px]" />
              )}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {/* Line 1 — confirmation + source + tags */}
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="shrink-0"
                style={{ fontSize: 13.5, color: "var(--text-1)", fontWeight: 640 }}
              >
                {headline}
              </span>
              <span
                className="truncate"
                style={{ fontSize: 11.5, color: "var(--text-2)" }}
                title={state.source}
              >
                · {state.source}
              </span>
              {hasTags ? (
                <span className="flex shrink-0 gap-1">
                  {autoTags.slice(0, 2).map((tag, index) => (
                    <span
                      key={tag}
                      className="rounded-full px-1.5 py-0.5"
                      style={{
                        background: "var(--accent-muted)",
                        color: "var(--accent-hover)",
                        fontSize: 9.5,
                        fontWeight: 700,
                        animation: `tagFadeIn 200ms ${index * 140}ms var(--ease-settle) both`,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              ) : (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5"
                  style={{
                    background: "rgba(99,102,241,0.1)",
                    color: "var(--accent-hover)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Tagging
                </span>
              )}
            </div>

            {/* Line 2 — preview / detail */}
            <p
              className="truncate"
              style={{
                marginTop: 2,
                fontSize: 11,
                color: "var(--text-2)",
                lineHeight: 1.35,
              }}
              title={state.detail}
            >
              {state.detail}
            </p>
          </div>

          {quietClose}

          {/* Line 3 — shrinking timer bar */}
          <div
            className="absolute bottom-1.5 left-3.5 right-3.5 h-[1.5px] overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.045)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: "var(--signal-success)",
                opacity: 0.55,
                animation: "shrink 4s linear forwards",
              }}
            />
          </div>
        </div>
      </OverlayShell>
    );
  }

  // ── DUPLICATE ─────────────────────────────────────────────────────────────
  // §3.6 honest states: a duplicate isn't a fresh save, so success chrome here
  // would be a lie. Neutral indigo tone + info glyph keeps the user informed
  // without implying green-check success.

  if (state.mode === "duplicate") {
    return (
      <OverlayShell dataState="duplicate">
        {dragGrip}
        <div className="relative flex h-full items-center gap-3 px-3.5 pt-1">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background: "rgba(129,140,248,0.1)",
              color: "var(--accent-hover)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <InfoIcon className="h-[17px] w-[17px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="shrink-0"
                style={{ fontSize: 13.5, color: "var(--text-1)", fontWeight: 640 }}
              >
                Already captured
              </span>
              <span
                className="truncate"
                style={{ fontSize: 11.5, color: "var(--text-2)" }}
                title={state.source}
              >
                · {state.source}
              </span>
            </div>
            <p
              className="truncate"
              style={{
                marginTop: 2,
                fontSize: 11,
                color: "var(--text-2)",
                lineHeight: 1.35,
              }}
              title={state.detail}
            >
              {state.detail}
            </p>
          </div>

          {quietClose}

          {/* Dimmer timer bar so the user knows the HUD is going to auto-dismiss,
              without using the bright success green that implies a fresh save. */}
          <div
            className="absolute bottom-1.5 left-3.5 right-3.5 h-[1.5px] overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: "var(--accent-hover)",
                opacity: 0.4,
                animation: "shrink 4s linear forwards",
              }}
            />
          </div>
        </div>
      </OverlayShell>
    );
  }

  // ── SCREENSHOTTING ────────────────────────────────────────────────────────

  if (state.mode === "screenshotting") {
    return (
      <OverlayShell dataState="screenshotting">
        {dragGrip}
        <div className="relative flex h-full items-center gap-3 px-3.5 pt-1">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background: "rgba(99,102,241,0.12)",
              color: "var(--accent-hover)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <CameraIcon className="h-[17px] w-[17px] animate-pulse" />
          </div>

          <div className="min-w-0 flex-1">
            <p
              style={{
                fontSize: 13,
                color: "var(--text-1)",
                fontWeight: 640,
                lineHeight: 1.2,
              }}
            >
              Drag a region to capture
            </p>
            <p
              style={{
                marginTop: 2,
                fontSize: 10.5,
                color: "var(--text-2)",
              }}
            >
              Esc cancels without saving.
            </p>
          </div>

          <span className="kbd-pill">Esc</span>
        </div>
      </OverlayShell>
    );
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────

  if (state.mode === "error") {
    const err = errorContent(state.kind, state.message);
    const tone = state.kind === "empty" ? "neutral" : "warn";

    return (
      <OverlayShell dataState="error">
        {dragGrip}
        <div className="relative flex h-full items-center gap-3 px-3.5 pt-1">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background:
                tone === "warn"
                  ? "rgba(251,191,36,0.14)"
                  : "rgba(255,255,255,0.05)",
              color:
                tone === "warn"
                  ? "var(--signal-warning)"
                  : "var(--text-2)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            {tone === "warn" ? <AlertIcon /> : <EmptyIcon />}
          </div>

          <div className="min-w-0 flex-1">
            <p
              style={{
                fontSize: 13,
                color: "var(--text-1)",
                fontWeight: 640,
                lineHeight: 1.2,
              }}
            >
              {err.headline}
            </p>
            <p
              className="truncate"
              style={{
                marginTop: 2,
                fontSize: 10.5,
                color: "var(--text-2)",
              }}
              title={err.body}
            >
              {err.body}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5" {...noDrag}>
            {state.kind === "permission" && (
              <button
                {...noDrag}
                onClick={openScreenCaptureSettings}
                className="rounded-[10px] px-2.5 py-1.5 transition-opacity hover:opacity-90"
                style={{
                  background: "rgba(251,191,36,0.16)",
                  color: "var(--signal-warning)",
                  border: "1px solid rgba(251,191,36,0.32)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                }}
              >
                Open Settings
              </button>
            )}
            {state.kind === "failed" && (
              <button
                {...noDrag}
                onClick={retryLastAction}
                className="rounded-[10px] px-2.5 py-1.5 transition-opacity hover:opacity-90"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--text-1)",
                  border: "1px solid var(--border-default)",
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                Try again
              </button>
            )}
            {quietClose}
          </div>
        </div>
      </OverlayShell>
    );
  }

  // ── INTERACTIVE (default fallthrough) ─────────────────────────────────────

  return (
    <OverlayShell dataState="interactive">
      {dragGrip}
      <div className="relative flex h-full items-center gap-3 px-3.5 pt-1">
        {/* Zone 1 — icon */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: "rgba(99,102,241,0.12)",
            color: "var(--accent-hover)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <ClipboardIcon className="h-[17px] w-[17px]" />
        </div>

        {/* Zone 2 — one-line instruction. §4.2: shrink copy volume, no subtitle. */}
        <div className="min-w-0 flex-1">
          <p
            style={{
              fontSize: 13.5,
              color: "var(--text-1)",
              fontWeight: 640,
              lineHeight: 1.25,
            }}
          >
            Pick what to capture
          </p>
        </div>

        {/* Zone 3 — one matte segmented action unit */}
        <div
          {...noDrag}
          className="flex shrink-0 items-center rounded-[12px]"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border-default)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: 2,
          }}
        >
          <button
            {...noDrag}
            onClick={doClip}
            className="rounded-[10px] px-2.5 py-1.5 transition-colors"
            style={{
              color: "var(--text-1)",
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            Text
          </button>
          <div aria-hidden style={{ width: 1, height: 14, background: "var(--border-default)" }} />
          <button
            {...noDrag}
            onClick={doScreenshot}
            className="rounded-[10px] px-2.5 py-1.5 transition-colors"
            style={{
              color: "var(--accent-hover)",
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-muted)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            Screen
          </button>
        </div>

        {quietClose}
      </div>
    </OverlayShell>
  );
}

function errorContent(kind: ErrorKind, message?: string) {
  switch (kind) {
    case "permission":
      return {
        headline: "Screen recording needs permission",
        body:
          message ||
          "Enable Research Inbox in System Settings → Privacy & Security → Screen Recording.",
      };
    case "empty":
      return {
        headline: "Nothing selected to capture",
        body: "Highlight text or press ⇧⌘S again to grab a region.",
      };
    case "failed":
    default:
      return {
        headline: "Capture failed",
        body:
          message ||
          "Something blocked the capture. Try again, or close and retry from the tray.",
      };
  }
}
