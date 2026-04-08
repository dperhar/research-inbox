import { useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { TAG_COLORS, type CaptureItem } from "../types";
import { t } from "../lib/i18n";
import TagInput from "./TagInput";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// App-specific badge colors (deterministic by app name)
const APP_BADGE_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
];

function appBadgeColor(appName: string): string {
  const hash = Array.from(appName).reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0);
  return APP_BADGE_COLORS[Math.abs(hash) % APP_BADGE_COLORS.length];
}

interface ItemCardProps {
  item: CaptureItem;
}

export default function ItemCard({ item }: ItemCardProps) {
  const { selectedIds, toggleSelect, expandedId, setExpanded, deleteItem, updateItemTags, showToast } = useStore();
  const [showContext, setShowContext] = useState(false);
  const isSelected = selectedIds.has(item.id);
  const isExpanded = expandedId === item.id;

  const time = new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const preview = item.content.slice(0, 120);
  const isImage = item.content_type === "image";
  const colorIndex = (name: string) => {
    const hash = Array.from(name).reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0);
    return Math.abs(hash) % 8;
  };

  const handleCopy = async () => {
    await writeText(item.content);
    showToast("Copied");
  };

  const handleArchive = async () => {
    await api.updateItem(item.id, null, null, true);
    useStore.getState().loadItems(useStore.getState().showArchived);
  };

  return (
    <div
      className={`relative group border-b border-[var(--border)] px-3 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
      onClick={() => setExpanded(isExpanded ? null : item.id)}
      onContextMenu={(e) => { e.preventDefault(); setShowContext(!showContext); }}
    >
      {/* Checkbox */}
      <div className="absolute left-1 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
          className="w-3.5 h-3.5 accent-[var(--accent)]"
        />
      </div>

      <div className="ml-4">
        {/* Header with source app badge */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {/* App badge */}
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-white text-[10px] font-semibold ${appBadgeColor(item.source_app)}`}>
            {isImage && (
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              </svg>
            )}
            {item.source_app}
          </span>

          <span className="text-[var(--text-secondary)]">{time}</span>

          <span className="text-[var(--text-secondary)] opacity-60">{item.char_count.toLocaleString()} ch</span>

          {item.source_title && !isImage && (
            <span className="text-[var(--text-secondary)] opacity-50 truncate max-w-[140px]">{item.source_title}</span>
          )}
        </div>

        {/* Content preview with inline images */}
        <div className="mt-1 text-[13px] text-[var(--text)] selectable leading-relaxed">
          {(() => {
            // Extract image paths from content — matches [Image: /path] and [Screenshot: /path]
            const imgRegex = /\[(?:Image|Screenshot): ([^\]]+)\]/g;
            const images: string[] = [];
            let match;
            while ((match = imgRegex.exec(item.content)) !== null) {
              images.push(match[1]);
            }
            const textOnly = item.content.replace(/\n*\[(?:Image|Screenshot): [^\]]+\]/g, "").trim();
            const displayText = isExpanded ? textOnly : textOnly.slice(0, 120);

            return (
              <>
                {displayText && (
                  isExpanded ? (
                    <div className="whitespace-pre-wrap break-words">{displayText}</div>
                  ) : (
                    <span className="opacity-90">"{displayText}{textOnly.length > 120 ? "..." : ""}"</span>
                  )
                )}
                {/* Show images — thumbnails when collapsed, larger when expanded */}
                {images.length > 0 && (
                  <div className={`flex gap-1.5 mt-1.5 ${isExpanded ? "flex-wrap" : "overflow-hidden"}`}>
                    {images.slice(0, isExpanded ? 10 : 3).map((imgPath, i) => (
                      <img
                        key={i}
                        src={`asset://localhost/${imgPath}`}
                        alt=""
                        className={`rounded border border-[var(--border)] object-cover ${
                          isExpanded ? "max-w-[200px] max-h-[150px]" : "w-10 h-10"
                        }`}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ))}
                    {!isExpanded && images.length > 3 && (
                      <span className="text-[10px] text-[var(--text-secondary)] self-center">+{images.length - 3}</span>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TAG_COLORS[colorIndex(tag)]}`}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Expanded: tag editor + actions */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <TagInput value={item.tags} onChange={(tags) => updateItemTags(item.id, tags)} />
            <div className="flex gap-3 mt-2">
              <button onClick={handleCopy} className="text-xs text-[var(--accent)] hover:underline font-medium">{t("copy")}</button>
              <button onClick={handleArchive} className="text-xs text-[var(--text-secondary)] hover:underline">{t("archive")}</button>
              <button onClick={() => { if (confirm(t("delete_confirm"))) deleteItem(item.id); }} className="text-xs text-red-500 hover:underline">{t("delete")}</button>
            </div>
            {item.source_url && (
              <div className="mt-1.5 text-[10px] text-[var(--accent)] opacity-70 truncate">
                {item.source_url}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {showContext && (
        <div
          className="absolute right-2 top-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl z-20 py-1 min-w-[140px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { handleCopy(); setShowContext(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)] transition-colors">{t("copy")}</button>
          <button onClick={() => { setShowContext(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)] transition-colors">{t("add_to_pack")}</button>
          <div className="border-t border-[var(--border)] my-1" />
          <button onClick={() => { handleArchive(); setShowContext(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)] transition-colors">{t("archive")}</button>
          <button onClick={() => { if (confirm(t("delete_confirm"))) { deleteItem(item.id); } setShowContext(false); }} className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-[var(--bg-secondary)] transition-colors">{t("delete")}</button>
        </div>
      )}
    </div>
  );
}
