import { useState, useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { TAG_COLORS } from "../types";
import { t } from "../lib/i18n";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

export default function TagInput({ value, onChange }: TagInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; color_index: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { tags, loadTags } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.length > 0) {
      loadTags(input);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [input]);

  useEffect(() => {
    setSuggestions(tags.filter((tag) => !value.includes(tag.name)));
  }, [tags, value]);

  const addTag = (tagName: string) => {
    const normalized = tagName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 30);
    if (normalized && !value.includes(normalized)) {
      onChange([...value, normalized]);
    }
    setInput("");
    setShowSuggestions(false);
  };

  const removeTag = (tagName: string) => {
    onChange(value.filter((t) => t !== tagName));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (input.trim()) addTag(input.trim());
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const colorIndex = (name: string) => {
    const hash = Array.from(name).reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0);
    return Math.abs(hash) % 8;
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1 items-center p-1.5 border border-[var(--border-default)] rounded-md bg-[var(--surface-input)] min-h-[32px]">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 font-medium"
            style={{
              background: TAG_COLORS[colorIndex(tag) % TAG_COLORS.length].bg,
              color: TAG_COLORS[colorIndex(tag) % TAG_COLORS.length].text,
              borderRadius: "var(--radius-tag)",
              padding: "1px 6px",
              fontSize: "var(--text-metadata)",
            }}
          >
            #{tag}
            <button onClick={() => removeTag(tag)} className="ml-0.5 hover:opacity-70">&times;</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => input && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={value.length === 0 ? t("add_tag") : ""}
          className="flex-1 min-w-[60px] bg-transparent outline-none text-xs text-[var(--text-1)]"
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-md shadow-lg z-10 max-h-[120px] overflow-y-auto" style={{ boxShadow: "var(--shadow-elevated)" }}>
          {suggestions.map((s) => (
            <button
              key={s.name}
              onMouseDown={(e) => { e.preventDefault(); addTag(s.name); }}
              className="w-full text-left px-2 py-1 text-xs hover:bg-[var(--surface-card-hover)] flex items-center gap-1"
            >
              <span
                style={{
                  background: TAG_COLORS[s.color_index % TAG_COLORS.length].bg,
                  color: TAG_COLORS[s.color_index % TAG_COLORS.length].text,
                  borderRadius: "var(--radius-tag)",
                  padding: "1px 6px",
                  fontSize: "var(--text-metadata)",
                }}
              >#{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
