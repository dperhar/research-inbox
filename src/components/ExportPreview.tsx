import { useState, useEffect } from "react";
import { api } from "../lib/ipc";
import type { ExportFormat } from "../types";

interface ExportPreviewProps {
  packId: string;
  initialFormat: ExportFormat;
  itemCount: number;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "claude", label: "Claude" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "cursor", label: "Cursor" },
];

export default function ExportPreview({ packId, initialFormat, itemCount }: ExportPreviewProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(itemCount > 3);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    api.exportPack(packId, format)
      .then((text) => setContent(text))
      .catch(() => setContent("(export failed)"))
      .finally(() => setLoading(false));
  }, [packId, format, expanded]);

  const charCount = content.length;
  const tokenEstimate = Math.ceil(charCount / 4);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--well-floor)",
        border: "1px solid var(--border-subtle, var(--border-default))",
      }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: "var(--well-wall)" }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80 mr-auto"
          style={{ color: "var(--text-3, var(--text-secondary))" }}
        >
          Export Preview {expanded ? "▲" : "▼"}
        </button>

        {/* Format selector */}
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          className="text-[11px] rounded px-1.5 py-0.5 outline-none"
          style={{
            background: "var(--well-floor)",
            color: "var(--text-1)",
            border: "1px solid var(--border-default)",
          }}
        >
          {FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {expanded && charCount > 0 && (
          <span
            className="text-[10px]"
            style={{ color: "var(--text-3, var(--text-secondary))" }}
          >
            {charCount.toLocaleString()} chars / ~{tokenEstimate.toLocaleString()} tokens
          </span>
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className="px-3 py-2">
          {loading ? (
            <p
              className="text-[11px]"
              style={{ color: "var(--text-3, var(--text-secondary))" }}
            >
              Loading...
            </p>
          ) : (
            <pre
              className="text-[10px] leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
              style={{
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                color: "var(--text-2)",
              }}
            >
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
