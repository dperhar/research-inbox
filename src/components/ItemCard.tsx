import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { TAG_COLORS, type CaptureItem } from "../types";
import { t } from "../lib/i18n";
import TagInput from "./TagInput";

// v2.5 evidence strip.
// Collapsed cards read as proof (source · time · preview · thumbnail if any),
// not as feed posts. AI summary, tag editing, and actions live inside the
// expanded state so scan speed is protected by default.

interface ItemCardProps {
  item: CaptureItem;
}

function colorIndex(value: string) {
  const hash = Array.from(value).reduce(
    (acc, char) => acc * 31 + char.charCodeAt(0),
    0,
  );
  return Math.abs(hash) % TAG_COLORS.length;
}

function extractImages(content: string) {
  const imgRegex = /\[(?:Image|Screenshot): ([^\]]+)\]/g;
  const images: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

function stripImageRefs(content: string) {
  return content.replace(/\n*\[(?:Image|Screenshot): [^\]]+\]/g, "").trim();
}

function appInitials(sourceApp: string) {
  return sourceApp
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function normalizeSourceLabel(
  sourceApp: string,
  sourceTitle?: string,
  preferVisual = false,
) {
  const source = sourceApp.trim();
  const title = sourceTitle?.trim();
  if (!source || /^(app|application|unknown)$/i.test(source)) {
    if (title) return title;
    return preferVisual ? "Screen capture" : "Current app";
  }
  return source;
}

function trimPreview(content: string, max = 180) {
  const squeezed = content.replace(/\s+/g, " ").trim();
  if (squeezed.length <= max) return squeezed;
  return squeezed.slice(0, max - 1).trimEnd() + "…";
}

export default function ItemCard({ item }: ItemCardProps) {
  const {
    selectedIds,
    toggleSelect,
    expandedId,
    setExpanded,
    deleteItem,
    updateItemTags,
    showToast,
  } = useStore();
  const [showContext, setShowContext] = useState(false);

  const isSelected = selectedIds.has(item.id);
  const isExpanded = expandedId === item.id;
  const isImage = item.content_type === "image";
  const sourceColor = TAG_COLORS[colorIndex(item.source_app)];
  const contentClass = item.enrichment?.content_class
    ? item.enrichment.content_class[0].toUpperCase() +
      item.enrichment.content_class.slice(1)
    : null;
  const time = new Date(item.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const images = extractImages(item.content);
  const hasImages = images.length > 0;
  const textOnly = stripImageRefs(item.content);
  const preview = trimPreview(textOnly, isExpanded ? 2000 : 180);
  const summary = item.enrichment?.summary?.trim();
  // §4.3 — checkbox only visible once selection mode is active or intentionally summoned.
  const selectionActive = selectedIds.size > 0;
  const showCheckbox = selectionActive || isSelected;
  const sourceLabel = normalizeSourceLabel(
    item.source_app,
    item.source_title,
    isImage || hasImages,
  );
  const sourceTitle = item.source_title?.trim();
  const metaBits = [
    time,
    hasImages
      ? `${images.length} image${images.length === 1 ? "" : "s"}`
      : `${item.char_count.toLocaleString()} ch`,
    contentClass && (!hasImages || contentClass.toLowerCase() !== "screenshot")
      ? contentClass
      : null,
  ].filter(Boolean) as string[];

  const handleCopy = async () => {
    await writeText(item.content);
    showToast("Copied");
  };

  const handleArchive = async () => {
    await api.updateItem(item.id, null, null, true);
    await useStore.getState().loadItems(useStore.getState().showArchived);
  };

  return (
    <div
      className="evidence-strip group relative cursor-pointer overflow-visible"
      data-selected={isSelected ? "true" : "false"}
      onClick={() => setExpanded(isExpanded ? null : item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowContext((visible) => !visible);
      }}
    >
      {/* Left-edge accent appears only when selected — no decorative sheen by default. */}
      {showCheckbox && (
        <div className="absolute left-2.5 top-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              toggleSelect(item.id);
            }}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div
        className="px-3 py-2.5"
        style={{ paddingLeft: showCheckbox ? 34 : 12 }}
      >
        <div className="flex items-start gap-2.5">
          {/* Source chip — small, stable, identifies the provenance fast. */}
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
            style={{
              background: sourceColor.bg,
              color: sourceColor.text,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
            title={sourceLabel}
          >
            {isImage || (hasImages && !textOnly) ? (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 16.5l4.5-4.5 3.75 3.75 4.5-6 3.75 4.5M5.25 19.5h13.5A1.5 1.5 0 0020.25 18V6A1.5 1.5 0 0018.75 4.5H5.25A1.5 1.5 0 003.75 6v12a1.5 1.5 0 001.5 1.5zm4.5-9h.008v.008H9.75V10.5z"
                />
              </svg>
            ) : (
              appInitials(item.source_app)
            )}
          </div>

          <div className="min-w-0 flex-1">
            {/* Source line — identity stays stable regardless of content. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className="truncate"
                style={{
                  fontSize: 12,
                  color: "var(--text-1)",
                  fontWeight: 640,
                }}
                title={sourceLabel}
              >
                {sourceLabel}
              </span>
              <span
                className="shrink-0"
                style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  fontFeatureSettings: "'tnum'",
                }}
              >
                {metaBits.join(" · ")}
              </span>
            </div>

            {/* Preview — 1-2 useful lines by default, not noisy wall text. */}
            {preview && (
              <p
                className="selectable mt-1"
                style={{
                  fontSize: 12,
                  lineHeight: 1.42,
                  color: "var(--text-2)",
                  display: "-webkit-box",
                  WebkitLineClamp: isExpanded ? undefined : 2,
                  WebkitBoxOrient: "vertical",
                  overflow: isExpanded ? "visible" : "hidden",
                  whiteSpace: isExpanded ? "pre-wrap" : "normal",
                  wordBreak: "break-word",
                }}
              >
                {preview}
              </p>
            )}

            {!isExpanded && item.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.tags.slice(0, 3).map((tag) => {
                  const tone = TAG_COLORS[colorIndex(tag)];
                  return (
                    <span
                      key={tag}
                      className="truncate rounded-full px-1.5 py-[1px]"
                      style={{
                        maxWidth: 120,
                        background: tone.bg,
                        color: tone.text,
                        fontSize: 9.5,
                        fontWeight: 600,
                      }}
                    >
                      #{tag}
                    </span>
                  );
                })}
                {item.tags.length > 3 && (
                  <span
                    style={{
                      fontSize: 9.5,
                      color: "var(--text-3)",
                      fontWeight: 600,
                    }}
                  >
                    +{item.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right-side thumbnail — proof, not decoration. Only when images exist. */}
          {!isExpanded && hasImages && (
            <div
              className="relative h-[54px] w-[72px] shrink-0 overflow-hidden rounded-[8px]"
              style={{
                border: "1px solid var(--border-default)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <img
                src={`asset://localhost/${images[0]}`}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {images.length > 1 && (
                <span
                  className="absolute bottom-1 right-1 rounded-full px-1 py-[1px]"
                  style={{
                    background: "rgba(5,5,8,0.78)",
                    color: "var(--text-1)",
                    fontSize: 9,
                    fontWeight: 700,
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                  }}
                >
                  +{images.length - 1}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expanded — AI summary, full images, tag edit, actions, URL. */}
        {isExpanded && (
          <div
            className="mt-2.5 border-t pt-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {summary && (
              <div
                className="mb-2.5 flex items-start gap-2 rounded-[10px] px-2.5 py-1.5"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5"
                  style={{
                    background: "var(--accent-muted)",
                    color: "var(--accent-hover)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  AI note
                </span>
                <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.45 }}>
                  {summary}
                </p>
              </div>
            )}

            {hasImages && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {images.slice(0, 8).map((imgPath, index) => (
                  <img
                    key={index}
                    src={`asset://localhost/${imgPath}`}
                    alt=""
                    className="rounded-[10px] object-cover"
                    style={{
                      width: 132,
                      height: 96,
                      border: "1px solid var(--border-default)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ))}
              </div>
            )}

            <TagInput
              value={item.tags}
              onChange={(tags) => updateItemTags(item.id, tags)}
            />

            {sourceTitle && sourceTitle !== sourceLabel && (
              <p
                className="mt-2.5 truncate selectable"
                style={{ fontSize: 11, color: "var(--text-2)" }}
                title={sourceTitle}
              >
                {sourceTitle}
              </p>
            )}

            {item.source_url && (
              <p
                className="mt-1 truncate selectable"
                style={{ fontSize: 11, color: "var(--text-3)" }}
                title={item.source_url}
              >
                {item.source_url}
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <button
                onClick={handleCopy}
                className="rounded-full px-2.5 py-1"
                style={{
                  background: "var(--accent-muted)",
                  color: "var(--accent-hover)",
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                {t("copy")}
              </button>
              <button
                onClick={handleArchive}
                className="rounded-full px-2.5 py-1"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  color: "var(--text-2)",
                  fontSize: 10.5,
                  fontWeight: 600,
                }}
              >
                {t("archive")}
              </button>
              <button
                onClick={() => {
                  if (confirm(t("delete_confirm"))) deleteItem(item.id);
                }}
                className="rounded-full px-2.5 py-1"
                style={{
                  background: "rgba(248,113,113,0.1)",
                  color: "var(--signal-error)",
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                {t("delete")}
              </button>
            </div>
          </div>
        )}
      </div>

      {showContext && (
        <div
          className="absolute right-2.5 top-9 z-20 min-w-[148px] rounded-[12px] py-1"
          style={{
            background: "var(--surface-elevated)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-elevated)",
            backdropFilter: "blur(18px) saturate(145%)",
            WebkitBackdropFilter: "blur(18px) saturate(145%)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              handleCopy();
              setShowContext(false);
            }}
            className="w-full px-3 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            style={{ fontSize: 11, color: "var(--text-1)" }}
          >
            {t("copy")}
          </button>
          <button
            onClick={() => setShowContext(false)}
            className="w-full px-3 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            style={{ fontSize: 11, color: "var(--text-1)" }}
          >
            {t("add_to_pack")}
          </button>
          <div
            style={{
              height: 1,
              background: "var(--border-subtle)",
              margin: "4px 0",
            }}
          />
          <button
            onClick={() => {
              handleArchive();
              setShowContext(false);
            }}
            className="w-full px-3 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            style={{ fontSize: 11, color: "var(--text-1)" }}
          >
            {t("archive")}
          </button>
          <button
            onClick={() => {
              if (confirm(t("delete_confirm"))) deleteItem(item.id);
              setShowContext(false);
            }}
            className="w-full px-3 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            style={{ fontSize: 11, color: "var(--signal-error)" }}
          >
            {t("delete")}
          </button>
        </div>
      )}
    </div>
  );
}
