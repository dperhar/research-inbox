import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import AskBar from "./AskBar";
import ItemCard from "./ItemCard";
import BottomNav from "./BottomNav";
import TopicsView from "./TopicsView";
import type { CaptureItem } from "../types";

const groupByDay = (items: CaptureItem[]) => {
  const groups: { label: string; items: CaptureItem[] }[] = [];
  let currentLabel = "";

  for (const item of items) {
    const date = new Date(item.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    let label: string;
    if (date.toDateString() === today.toDateString()) label = "Today";
    else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (label !== currentLabel) {
      groups.push({ label, items: [item] });
      currentLabel = label;
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }
  return groups;
};

export default function InboxPanel() {
  const { view, items, selectedIds, showArchived, loadItems, selectAll, clearSelection, archiveSelected, searchItems, searchQuery, showToast, setEditingPack } = useStore();

  useEffect(() => {
    loadItems(showArchived);
  }, [showArchived]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === "a") {
      e.preventDefault();
      selectAll();
    }
    if (e.metaKey && e.key === "Backspace") {
      e.preventDefault();
      archiveSelected();
    }
  };

  return (
    <div
      className="flex flex-col h-full well-depth"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ animation: "panelReveal 280ms var(--ease-well-open) both" }}
    >
      {/* Minimal title bar – just drag region + close */}
      <div
        className="flex items-center px-3 pt-2 pb-0"
        data-tauri-drag-region
        style={{ background: "var(--well-wall)" }}
      >
        <div className="flex-1" data-tauri-drag-region />
        <button
          onClick={() => getCurrentWindow().hide()}
          className="w-5 h-5 flex items-center justify-center rounded transition-colors"
          style={{ color: "var(--text-3)", opacity: 0.5 }}
          title="Hide"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* AskBar – prominent, no clutter */}
      <div
        className="px-3 pt-2 pb-2"
        style={{ background: "var(--well-wall)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <AskBar
          onSearch={(q) => {
            if (q) searchItems(q);
            else loadItems(showArchived);
          }}
          onIntent={async (intent) => {
            showToast("Generating pack...");
            try {
              const result = await api.generatePack(intent);
              const pack = await api.createPack(
                result.title,
                result.summary,
                null,
                null,
                result.item_ids,
                "markdown",
              );
              setEditingPack(pack);
            } catch (e: any) {
              showToast("Pack generation failed: " + (e?.toString() || "unknown error"));
            }
          }}
          onChat={() => {}}
          onAsk={async (_question) => {
            showToast("Ask mode coming soon...");
          }}
        />

        {/* Selection bar – only shown when items are selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mt-1.5 text-[11px]">
            <span className="text-[var(--accent)] font-medium">
              {t("items_selected", { count: selectedIds.size })}
            </span>
            <button onClick={clearSelection} className="text-[var(--text-2)] hover:underline">{t("cancel")}</button>
            <button onClick={archiveSelected} className="text-[var(--text-2)] hover:underline">{t("archive")}</button>
          </div>
        )}
      </div>

      {/* Content area – swaps between Stream and Topics */}
      {view === "topics" ? (
        <TopicsView />
      ) : (
        <div
          className="flex-1 overflow-y-auto"
          style={{
            background: "var(--well-floor)",
            backgroundImage: "var(--well-glow)",
            backgroundRepeat: "no-repeat",
          }}
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              {searchQuery ? (
                <p className="text-sm" style={{ color: "var(--text-2)" }}>
                  {t("no_results", { query: searchQuery })}
                </p>
              ) : (
                <p style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-3)" }}>
                  Press ⇧⌘S to capture your first signal.
                </p>
              )}
            </div>
          ) : (
            groupByDay(items).map((group) => (
              <div key={group.label}>
                <div
                  className="px-3 py-1.5 sticky top-0"
                  style={{
                    fontSize: "var(--text-metadata, 11px)",
                    color: "var(--text-3, var(--text-2))",
                    fontWeight: 600,
                    background: "var(--well-floor)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {group.label}
                </div>
                <div className="px-2 pb-1">
                  {group.items.map((item) => <ItemCard key={item.id} item={item} />)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
