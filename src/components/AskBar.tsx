import { useState, useRef, useEffect, useCallback } from "react";

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
  search: "Ask or search...",
  intent: "Describe what to collect...",
  chat: "Chat with this pack...",
  ask: "Ask a question...",
};

const MODE_HINTS: Record<AskBarMode, string> = {
  search: "",
  intent: "Intent mode – press Enter to generate pack",
  chat: "Chat mode – press Enter to send",
  ask: "Ask mode – press Enter to get answer",
};

function ModeIcon({ mode }: { mode: AskBarMode }) {
  const cls = "w-3.5 h-3.5";
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
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

  // Slash commands force mode
  if (lower.startsWith("/search")) return "search";
  if (lower.startsWith("/pack") || lower.startsWith("/intent")) return "intent";
  if (lower.startsWith("/chat")) return "chat";
  if (lower.startsWith("/ask")) return "ask";

  // Intent hints
  if (
    lower.startsWith("pack") ||
    lower.startsWith("context for") ||
    lower.startsWith("собери") ||
    lower.startsWith("collect")
  ) return "intent";

  // Ask hints
  if (
    lower.startsWith("?") ||
    lower.startsWith("what") ||
    lower.startsWith("how") ||
    lower.startsWith("why") ||
    lower.startsWith("when") ||
    lower.startsWith("where")
  ) return "ask";

  return null;
}

export default function AskBar({ activePack, onSearch, onIntent, onChat, onAsk }: AskBarProps) {
  const [mode, setMode] = useState<AskBarMode>(activePack ? "chat" : "search");
  const [value, setValue] = useState("");
  const [suggestedMode, setSuggestedMode] = useState<AskBarMode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Force chat mode when pack is active
  useEffect(() => {
    if (activePack) {
      setMode("chat");
    }
  }, [activePack]);

  // Auto-focus on open
  useEffect(() => {
    inputRef.current?.focus();
    const handleFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // "/" shortcut to focus
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

  const cycleMode = useCallback(() => {
    if (activePack) return; // locked in chat when pack open
    const idx = MODES.indexOf(mode);
    setMode(MODES[(idx + 1) % MODES.length]);
    setSuggestedMode(null);
  }, [mode, activePack]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);

    // Check for slash commands – immediately switch mode
    const slash = detectSuggestedMode(v);
    if (v.startsWith("/")) {
      if (slash) {
        setMode(slash);
        setSuggestedMode(null);
        // Strip the command prefix from value
        const stripped = v.replace(/^\/\w+\s?/, "");
        setValue(stripped);
        return;
      }
    }

    setSuggestedMode(slash !== mode ? slash : null);

    // Debounced search in search mode
    if (mode === "search") {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onSearch(v);
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

  const hint = suggestedMode ? `Hint: press Tab to switch to ${suggestedMode} mode` : MODE_HINTS[mode];

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
        style={{
          background: "var(--surface-input, var(--well-floor))",
          boxShadow: "var(--shadow-input-inset, inset 0 1px 3px rgba(0,0,0,0.15))",
          border: "1px solid var(--border-subtle, var(--border-default))",
          borderRadius: "var(--radius-card, 8px)",
        }}
      >
        {/* Mode icon button */}
        <button
          type="button"
          onClick={cycleMode}
          title={activePack ? `Chat mode (pack: ${activePack.title})` : `Mode: ${mode} (click or Tab to cycle)`}
          className="flex-shrink-0 transition-opacity hover:opacity-70"
          style={{ color: "var(--text-3, var(--text-secondary))" }}
          tabIndex={-1}
        >
          <ModeIcon mode={mode} />
        </button>

        {/* Active pack badge */}
        {activePack && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0 max-w-[80px] truncate"
            style={{
              background: "var(--accent-muted, rgba(99,102,241,0.12))",
              color: "var(--accent)",
            }}
            title={activePack.title}
          >
            {activePack.title}
          </span>
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={MODE_PLACEHOLDERS[mode]}
          className="flex-1 bg-transparent outline-none text-sm min-w-0"
          style={{
            color: "var(--text-1, var(--text))",
          }}
        />

        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setSuggestedMode(null);
              onSearch("");
            }}
            className="flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: "var(--text-3, var(--text-secondary))" }}
            tabIndex={-1}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <span
            className="flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded"
            style={{
              color: "var(--text-3)",
              background: "var(--border-subtle)",
              letterSpacing: "0.02em",
              opacity: 0.7,
            }}
          >
            ⌘K
          </span>
        )}
      </div>

      {/* Hint text */}
      {hint && (
        <p
          className="text-[10px] px-1"
          style={{ color: suggestedMode ? "var(--accent)" : "var(--text-3, var(--text-secondary))" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
