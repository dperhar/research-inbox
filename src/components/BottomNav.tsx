import { useStore } from "../lib/store";

// v2.5 bottom nav.
// Quiet, lighter, infrastructural. Orients the user; does not announce itself.
// The content area is the main event — this bar just lets you switch lanes.

const TABS = [
  { id: "inbox", label: "Stream" },
  { id: "topics", label: "Topics" },
  { id: "packs", label: "Packs" },
] as const;

export default function BottomNav() {
  const { view, setView } = useStore();
  const activeTab =
    view === "topics" ? "topics" : view === "packs" ? "packs" : "inbox";

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5"
      style={{
        borderTop: "1px solid var(--border-subtle)",
        background: "linear-gradient(180deg, rgba(10,10,14,0.82) 0%, rgba(8,8,12,0.92) 100%)",
      }}
    >
      <div className="flex flex-1 items-center gap-0.5">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className="rounded-[9px] px-2.5 py-1 transition-colors"
              style={{
                background: active ? "rgba(255,255,255,0.05)" : "transparent",
                color: active ? "var(--text-1)" : "var(--text-2)",
                fontSize: 11,
                fontWeight: active ? 680 : 560,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setView("settings")}
        className="flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors"
        style={{
          color: "var(--text-3)",
          background: view === "settings" ? "rgba(255,255,255,0.05)" : "transparent",
        }}
        title="Settings"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color =
            view === "settings" ? "var(--text-1)" : "var(--text-3)";
        }}
      >
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  );
}
