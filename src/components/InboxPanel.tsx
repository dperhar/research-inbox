import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
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
    else if (date.toDateString() === yesterday.toDateString())
      label = "Yesterday";
    else
      label = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

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
  const {
    view,
    items,
    loading,
    selectedIds,
    showArchived,
    loadItems,
    selectAll,
    clearSelection,
    archiveSelected,
    searchItems,
    searchQuery,
    showToast,
    setEditingPack,
  } = useStore();

  useEffect(() => {
    loadItems(showArchived);
  }, [showArchived]);

  const todayCount = items.filter((item) => {
    const itemDate = new Date(item.created_at);
    return itemDate.toDateString() === new Date().toDateString();
  }).length;

  const sourceCount = new Set(items.map((item) => item.source_app)).size;

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

  // §4.3 Inbox shell — hero slogan removed. The first viewport answers
  // "what do I have, how do I get to the right context fast?" via the Ask Bar.
  const hasCaptures = items.length > 0;
  const showMetadata = hasCaptures || !!searchQuery;
  const metadataLine = searchQuery
    ? `${items.length} result${items.length === 1 ? "" : "s"} · “${searchQuery}”`
    : `${items.length} capture${items.length === 1 ? "" : "s"} · ${sourceCount} source${
        sourceCount === 1 ? "" : "s"
      } · ${todayCount} today`;

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ animation: "panelReveal 280ms var(--ease-well-open) both" }}
    >
      {/* v2.5 top chrome — compact draggable bar. Quiet, placeable. */}
      <div
        className="flex items-center px-3.5"
        data-tauri-drag-region
        style={{
          position: "relative",
          zIndex: 2,
          height: 26,
          borderBottom: "1px solid var(--border-subtle)",
          background:
            "linear-gradient(180deg, rgba(10,10,14,0.72) 0%, rgba(8,8,12,0.48) 100%)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
        }}
      >
        <div className="flex flex-1 items-center justify-center" data-tauri-drag-region>
          <span aria-hidden className="drag-grip" />
        </div>
        <button
          onClick={() => getCurrentWindow().hide()}
          className="flex h-5 w-5 items-center justify-center rounded-full transition-all"
          style={{ color: "var(--text-3)" }}
          title="Hide"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255,255,255,0.05)";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-3)";
          }}
        >
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div
        className="px-3.5 pb-2.5 pt-2.5"
        style={{
          position: "relative",
          zIndex: 1,
          borderBottom: "1px solid var(--border-subtle)",
          background:
            "linear-gradient(180deg, rgba(8,8,12,0.74) 0%, rgba(8,8,12,0.5) 100%)",
        }}
      >
        {/* One quiet metadata/status line. No hero slogan, no competing pills.
            Suppressed on first run (no captures, no search) — an empty line of
            zeros is just visual noise before the user has done anything. */}
        {showMetadata && (
          <div
            className="mb-2 flex items-center justify-between gap-2 px-0.5"
            style={{ fontSize: 10.5, color: "var(--text-3)" }}
          >
            <span
              className="truncate"
              style={{
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
              title={metadataLine}
            >
              {metadataLine}
            </span>
            {todayCount > 0 && !searchQuery && (
              <span
                className="shrink-0"
                style={{
                  fontFeatureSettings: "'tnum'",
                  color: "var(--text-2)",
                  fontWeight: 600,
                }}
              >
                Today
              </span>
            )}
          </div>
        )}

        <AskBar
          onSearch={(query) => {
            if (query) searchItems(query);
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
              showToast(
                "Pack generation failed: " + (e?.toString() || "unknown error"),
              );
            }
          }}
          onChat={() => {}}
          onAsk={async () => {
            showToast("Ask mode coming soon...");
          }}
        />

        {selectedIds.size > 0 && (
          <div className="surface-card-quiet mt-2.5 flex items-center justify-between gap-3 rounded-[14px] px-3 py-2">
            <div className="min-w-0">
              <p
                style={{
                  fontSize: 11,
                  color: "var(--accent-hover)",
                  fontWeight: 700,
                }}
              >
                {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}{" "}
                selected
              </p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                Archive or use them to assemble a pack.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={clearSelection}
                className="rounded-full px-2.5 py-1"
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                Clear
              </button>
              <button
                onClick={archiveSelected}
                className="rounded-full px-2.5 py-1"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--accent-hover)",
                  background: "var(--accent-muted)",
                }}
              >
                Archive
              </button>
            </div>
          </div>
        )}
      </div>

      {view === "topics" ? (
        <TopicsView />
      ) : (
        <div
          className="flex-1 overflow-y-auto px-3 pb-3"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,8,12,0.22) 0%, rgba(8,8,12,0.04) 100%), var(--well-glow)",
            backgroundRepeat: "no-repeat",
          }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center px-4">
              <div className="surface-card-quiet w-full rounded-[18px] px-5 py-6 text-center">
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  Loading your latest signals...
                </p>
              </div>
            </div>
          ) : items.length === 0 ? (
            // §3.6 honest states: "search-miss" and "empty inbox" are NOT the same
            // moment. An empty inbox is an onboarding prompt ("press ⇧⌘S");
            // a search-miss is a retrieval result ("your query didn't hit — widen
            // it, or clear it"). Each gets its own tone and CTA.
            <div className="flex h-full items-center justify-center px-3">
              {searchQuery ? (
                <div
                  className="w-full rounded-[14px] px-4 py-5 text-center"
                  style={{
                    background: "rgba(255,255,255,0.015)",
                    border: "1px dashed var(--border-default)",
                  }}
                >
                  <div
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--text-3)",
                    }}
                    aria-hidden
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <p
                    className="mt-2.5"
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-1)",
                      fontWeight: 620,
                    }}
                  >
                    No matches for “{searchQuery}”
                  </p>
                  <p
                    className="mt-1"
                    style={{
                      fontSize: 11,
                      color: "var(--text-2)",
                      lineHeight: 1.45,
                    }}
                  >
                    Widen the query, switch mode, or clear to browse recent captures.
                  </p>
                  <button
                    onClick={() => {
                      searchItems("");
                      // Broadcast so AskBar can drop its own local input value —
                      // otherwise the user sees the query still lingering in the
                      // input while results show latest captures (confusing state).
                      window.dispatchEvent(new CustomEvent("ri-clear-search"));
                    }}
                    className="mt-2.5 rounded-full px-3 py-1"
                    style={{
                      background: "var(--accent-muted)",
                      color: "var(--accent-hover)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="w-full rounded-[14px] px-4 py-5 text-center surface-card-quiet">
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-1)",
                      fontWeight: 600,
                    }}
                  >
                    No captures yet
                  </p>
                  <p
                    className="mt-1.5"
                    style={{
                      fontSize: 11.5,
                      color: "var(--text-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    Press ⇧⌘S from any app. Text or screen region — both land here.
                  </p>
                </div>
              )}
            </div>
          ) : (
            groupByDay(items).map((group) => (
              <section key={group.label}>
                <div
                  className="sticky top-0 z-10 px-1 pb-1.5 pt-3"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(5,5,8,0.96) 0%, rgba(5,5,8,0.8) 76%, rgba(5,5,8,0) 100%)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "var(--text-3)",
                        fontWeight: 700,
                      }}
                    >
                      {group.label}
                    </span>
                    <span
                      className="rounded-full px-1.5 py-0.5"
                      style={{
                        fontSize: 10,
                        color: "var(--text-2)",
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      {group.items.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 px-1 pb-1">
                  {group.items.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        animation: "itemStagger 220ms var(--ease-settle) both",
                        animationDelay: `${Math.min(index, 6) * 22}ms`,
                      }}
                    >
                      <ItemCard item={item} />
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
