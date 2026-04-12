import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import AskBar from "./AskBar";
import ItemCard from "./ItemCard";
import BottomNav from "./BottomNav";

export default function InboxPanel() {
  const { items, selectedIds, showArchived, setShowArchived, loadItems, selectAll, clearSelection, archiveSelected, searchItems, searchQuery, showToast, setEditingPack } = useStore();

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
    <div className="flex flex-col h-full well-depth" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Title bar: drag + capture buttons + close */}
      <div className="flex items-center px-3 pt-2 pb-1 gap-1 bg-[var(--well-wall)]" data-tauri-drag-region>
        <span className="text-xs font-semibold text-[var(--text-2)] select-none mr-auto" data-tauri-drag-region>Research Inbox</span>

        {/* Clip Text button */}
        <button
          onClick={() => invoke("trigger_text_capture")}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          title="Capture clipboard (⌥⌘C)"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3a2.25 2.25 0 00-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
          Clip
        </button>

        {/* Screenshot button */}
        <button
          onClick={() => invoke("trigger_screenshot_capture")}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-[var(--text-2)] hover:bg-[var(--well-floor)] transition-colors"
          title="Screenshot (⌥⌘S)"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          Screen
        </button>

        {/* Close */}
        <button
          onClick={() => getCurrentWindow().hide()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--well-floor)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors ml-1"
          title="Hide (⌥⌘R)"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Header */}
      <div className="px-3 pb-2 space-y-2 border-b border-[var(--border-default)] bg-[var(--well-wall)]">
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

        {/* Filter row */}
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex-1" />
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-3 h-3 accent-[var(--accent)]"
            />
            <span className="text-[var(--text-2)]">{t("show_archived")}</span>
          </label>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--accent)] font-medium">
              {t("items_selected", { count: selectedIds.size })}
            </span>
            <button onClick={clearSelection} className="text-[var(--text-2)] hover:underline">{t("cancel")}</button>
            <button onClick={archiveSelected} className="text-[var(--text-2)] hover:underline">{t("archive")}</button>
          </div>
        )}
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto bg-[var(--well-floor)]">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            {searchQuery ? (
              <p className="text-sm text-[var(--text-2)]">
                {t("no_results", { query: searchQuery })}
              </p>
            ) : (
              <>
                <div className="text-3xl mb-3">📋</div>
                <p className="text-sm text-[var(--text-2)]">
                  {t("no_items", { hotkey: "⌥⌘C" })}
                </p>
              </>
            )}
          </div>
        ) : (
          items.map((item) => <ItemCard key={item.id} item={item} />)
        )}
      </div>

      <BottomNav />
    </div>
  );
}
