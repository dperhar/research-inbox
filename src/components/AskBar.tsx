import { useState, useRef, useEffect, useCallback } from "react";

// v2.5 Ask Bar.
// Principles (§4.3): one dominant mode signal (the left icon), one secondary
// hint (the segmented pill row), calmer visuals, no repeated explanation.
// Feels like a tool, not a marketing banner.

export type AskBarMode = "search" | "intent" | "chat" | "ask";

interface AskBarProps {
  activePack?: { id: string; title: string } | null;
  onSearch: (query: string) => void;
  onIntent: (intent: string) => void;
  onChat: (instruction: string) => void;
  onAsk: (question: string) => void;
}

const MODES: AskBarMode[] = ["search", "intent", "chat", "ask"];

const MODE_PLACEHOLDERS: Record<AskBarMode, string> = {
  search: "Search your captures",
  intent: "Describe the context pack you need",
  chat: "Refine the current pack",
  ask: "Ask a question about your captures",
};

const MODE_LABELS: Record<AskBarMode, string> = {
  search: "Search",
  intent: "Pack",
  chat: "Chat",
  ask: "Ask",
};

function ModeIcon({ mode, className }: { mode: AskBarMode; className?: string }) {
  const cls = className ?? "h-3.5 w-3.5";
  switch (mode) {
    case "search":
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    case "intent":
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25H12" />
        </svg>
      );
    case "chat":
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      );
    case "ask":
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      );
  }
}

function detectSuggestedMode(value: string): AskBarMode | null {
  const lower = value.toLowerCase().trim();
  if (!lower) return null;

  if (lower.startsWith("/search")) return "search";
  if (lower.startsWith("/pack") || lower.startsWith("/intent")) return "intent";
  if (lower.startsWith("/chat")) return "chat";
  if (lower.startsWith("/ask")) return "ask";

  if (
    lower.startsWith("pack") ||
    lower.startsWith("context for") ||
    lower.startsWith("собери") ||
    lower.startsWith("collect")
  )
    return "intent";

  if (
    lower.startsWith("?") ||
    lower.startsWith("what") ||
    lower.startsWith("how") ||
    lower.startsWith("why") ||
    lower.startsWith("when") ||
    lower.startsWith("where") ||
    lower.startsWith("какой") ||
    lower.startsWith("сколько") ||
    lower.startsWith("почему")
  )
    return "ask";

  return null;
}

export default function AskBar({
  activePack,
  onSearch,
  onIntent,
  onChat,
  onAsk,
}: AskBarProps) {
  const [mode, setMode] = useState<AskBarMode>(activePack ? "chat" : "search");
  const [value, setValue] = useState("");
  const [suggestedMode, setSuggestedMode] = useState<AskBarMode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (activePack) {
      setMode("chat");
      setSuggestedMode(null);
    }
  }, [activePack]);

  useEffect(() => {
    inputRef.current?.focus();
    const handleFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  // §6 acceptance — Ask Bar is the dominant action surface, so external clears
  // (InboxPanel search-miss "Clear search" button) must also drop the input
  // value here. Otherwise the user sees a stale query sitting in the bar while
  // results show latest captures.
  useEffect(() => {
    const handler = () => {
      clearTimeout(timerRef.current);
      setValue("");
      setSuggestedMode(null);
    };
    window.addEventListener("ri-clear-search", handler);
    return () => window.removeEventListener("ri-clear-search", handler);
  }, []);

  const availableModes = activePack ? (["chat"] as AskBarMode[]) : MODES;

  const setManualMode = useCallback(
    (nextMode: AskBarMode) => {
      clearTimeout(timerRef.current);
      if (activePack && nextMode !== "chat") return;
      setMode(nextMode);
      setSuggestedMode(null);
      inputRef.current?.focus();
    },
    [activePack],
  );

  const cycleMode = useCallback(() => {
    if (activePack) return;
    const idx = MODES.indexOf(mode);
    setManualMode(MODES[(idx + 1) % MODES.length]);
  }, [mode, activePack, setManualMode]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    clearTimeout(timerRef.current);
    setValue(nextValue);

    const detected = detectSuggestedMode(nextValue);
    if (nextValue.startsWith("/")) {
      if (detected) {
        setMode(detected);
        setSuggestedMode(null);
        const stripped = nextValue.replace(/^\/\w+\s?/, "");
        setValue(stripped);
        if (detected === "search") onSearch(stripped);
        return;
      }
    }

    setSuggestedMode(detected && detected !== mode ? detected : null);

    if (mode === "search") {
      timerRef.current = setTimeout(() => {
        onSearch(nextValue);
      }, 150);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      cycleMode();
      return;
    }

    if (e.key === "Escape") {
      setValue("");
      setSuggestedMode(null);
      onSearch("");
      return;
    }

    if (e.key === "Enter") {
      const trimmed = value.trim();
      if (!trimmed) return;

      switch (mode) {
        case "search":
          onSearch(trimmed);
          break;
        case "intent":
          onIntent(trimmed);
          setValue("");
          setSuggestedMode(null);
          break;
        case "chat":
          onChat(trimmed);
          setValue("");
          setSuggestedMode(null);
          break;
        case "ask":
          onAsk(trimmed);
          setValue("");
          setSuggestedMode(null);
          break;
      }
    }
  };

  return (
    <div
      className="rounded-[14px]"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-card)",
        padding: "10px 10px 8px",
      }}
    >
      {/* Dominant signal row — left icon names the mode, placeholder reinforces it. */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={cycleMode}
          title={
            activePack
              ? `Chat mode · ${activePack.title}`
              : `${MODE_LABELS[mode]} · Tab to cycle`
          }
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] transition-transform hover:scale-[1.02]"
          style={{
            background: "var(--accent-muted)",
            color: "var(--accent-hover)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
          tabIndex={-1}
          aria-label={`Current mode: ${MODE_LABELS[mode]}`}
        >
          <ModeIcon mode={mode} />
        </button>

        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            activePack
              ? `Refine "${activePack.title}"`
              : MODE_PLACEHOLDERS[mode]
          }
          className="min-w-0 flex-1 bg-transparent outline-none"
          style={{
            color: "var(--text-1)",
            fontSize: 14,
            lineHeight: 1.3,
            fontWeight: 520,
          }}
        />

        <span
          className="kbd-pill shrink-0"
          title={activePack ? "Enter sends" : "Tab cycles mode · Enter runs"}
        >
          {activePack ? "↵" : "Tab"}
        </span>
      </div>

      {/* Secondary hint — single calm segmented row. Only surfaces when a switch is possible. */}
      {!activePack && (
        <div className="mt-2 flex items-center gap-1.5">
          {availableModes.map((entry) => {
            const active = mode === entry;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => setManualMode(entry)}
                className="rounded-full px-2 py-[3px] transition-colors"
                style={{
                  background: active ? "var(--accent-muted)" : "transparent",
                  color: active ? "var(--accent-hover)" : "var(--text-2)",
                  border: `1px solid ${active ? "rgba(129,140,248,0.22)" : "var(--border-subtle)"}`,
                  fontSize: 10,
                  fontWeight: active ? 700 : 560,
                  letterSpacing: "0.02em",
                }}
              >
                {MODE_LABELS[entry]}
              </button>
            );
          })}
          {suggestedMode && suggestedMode !== mode && (
            <button
              type="button"
              onClick={() => setManualMode(suggestedMode)}
              className="ml-auto rounded-full px-2 py-[3px] transition-opacity hover:opacity-85"
              style={{
                background: "rgba(255,255,255,0.03)",
                color: "var(--accent-hover)",
                border: "1px solid var(--border-subtle)",
                fontSize: 10,
                fontWeight: 600,
              }}
              title={`Looks like ${MODE_LABELS[suggestedMode]} mode`}
            >
              → {MODE_LABELS[suggestedMode]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
