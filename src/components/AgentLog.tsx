import { useState } from "react";
import type { AgentLogEntry } from "../types";

interface AgentLogProps {
  entries: AgentLogEntry[];
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

export default function AgentLog({ entries }: AgentLogProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(-4);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--well-floor)",
        border: "1px solid var(--border-subtle, var(--border-default))",
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-opacity hover:opacity-80"
        style={{ background: "var(--well-wall)" }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-3, var(--text-secondary))" }}
        >
          Agent Log
        </span>
        <span
          className="text-[10px]"
          style={{ color: "var(--text-3, var(--text-secondary))" }}
        >
          {entries.length} message{entries.length !== 1 ? "s" : ""}{" "}
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Entries */}
      <div className="px-3 py-2 space-y-2">
        {visible.map((entry, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span
              className="text-[10px] font-mono flex-shrink-0 mt-0.5"
              style={{ color: "var(--text-3, var(--text-secondary))", minWidth: 36 }}
            >
              {formatTs(entry.ts)}
            </span>
            <span
              className="text-[10px] font-semibold flex-shrink-0 uppercase"
              style={{
                color: entry.role === "user" ? "var(--accent)" : "var(--text-2)",
                minWidth: 20,
              }}
            >
              {entry.role === "user" ? "You" : "AI"}
            </span>
            <span
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--text-1)" }}
            >
              {entry.content}
            </span>
          </div>
        ))}
        {!expanded && entries.length > 4 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[10px] hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Show all {entries.length} messages
          </button>
        )}
      </div>
    </div>
  );
}
