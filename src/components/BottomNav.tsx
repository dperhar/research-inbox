import { useStore } from "../lib/store";

export default function BottomNav() {
    const { view, setView, items } = useStore();

    const todayCount = items.filter((i) => {
        const d = new Date(i.created_at);
        return d.toDateString() === new Date().toDateString();
    }).length;

    const activeTab = view === "topics" ? "topics" : view === "packs" ? "packs" : "inbox";

    const tabs = [
        { id: "inbox", label: "Stream", view: "inbox" },
        { id: "topics", label: "Topics", view: "topics" },
        { id: "packs", label: "Packs", view: "packs" },
    ] as const;

    return (
        <div className="flex items-center px-3 py-2"
            style={{
                background: "var(--well-rim)",
                borderTop: "1px solid var(--border-default)",
                fontSize: "var(--text-metadata, 11px)",
            }}>
            <div className="flex gap-1">
                {tabs.map((tab) => (
                    <button key={tab.id}
                        onClick={() => setView(tab.view)}
                        className="px-2 py-0.5 rounded font-medium transition-colors"
                        style={{
                            background: activeTab === tab.id ? "var(--accent-muted, rgba(99,102,241,0.12))" : "transparent",
                            color: activeTab === tab.id ? "var(--accent)" : "var(--text-3, var(--text-2))",
                        }}>
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="flex-1" />
            <button onClick={() => setView("settings")} className="mr-2 transition-opacity hover:opacity-70"
                style={{ color: "var(--text-3, var(--text-2))" }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
            <span style={{ color: "var(--text-3, var(--text-2))" }}>{todayCount} today</span>
        </div>
    );
}
