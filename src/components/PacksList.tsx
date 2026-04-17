import { useEffect } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export default function PacksList() {
  const { packs, loadPacks, setEditingPack, deletePack, setView, showToast } = useStore();

  useEffect(() => {
    loadPacks();
  }, []);

  const handleExport = async (id: string, format: string) => {
    const exported = await api.exportPack(id, format);
    await writeText(exported);
    showToast(`✓ ${t("pack_copied", { count: 0 })}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-3 py-2 border-b flex items-center gap-2"
        style={{
          background: "rgba(15, 15, 20, 0.72)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <button
          onClick={() => setView("inbox")}
          className="px-2 py-0.5 rounded text-[11px] text-[var(--text-2)] hover:bg-[var(--well-floor)]"
        >
          {t("inbox")}
        </button>
        <button
          className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--accent)] text-white"
        >
          {t("packs")}
        </button>
      </div>

      {/* Pack list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {packs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center px-2">
            <div
              className="w-full rounded-xl px-4 py-5"
              style={{
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                No context packs yet
              </p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--text-2)" }}>
                Select items and create a pack, or describe what you need in the search bar.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {packs.map((pack) => (
              <div
                key={pack.id}
                className="px-3 py-2.5 rounded-xl border bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] transition-colors"
                style={{
                  borderColor: "var(--border-subtle)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{pack.title}</div>
                  {pack.description && (
                    <div className="text-[11px] text-[var(--text-2)] truncate mt-0.5">{pack.description}</div>
                  )}
                  <div className="text-[10px] text-[var(--text-2)] mt-1">
                    {pack.item_ids.length} items · {pack.export_format} · {new Date(pack.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => handleExport(pack.id, pack.export_format)}
                    className="px-1.5 py-0.5 text-[10px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]"
                  >
                    {t("copy")}
                  </button>
                  <button
                    onClick={() => setEditingPack(pack)}
                    className="px-1.5 py-0.5 text-[10px] bg-[var(--surface-input)] border border-[var(--border-default)] rounded hover:bg-[var(--border-default)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { if (confirm(t("delete_confirm"))) deletePack(pack.id); }}
                    className="px-1.5 py-0.5 text-[10px] text-[var(--signal-error)] bg-[var(--surface-input)] border border-[var(--border-default)] rounded hover:bg-[var(--surface-card-hover)]"
                  >
                    &times;
                  </button>
                </div>
              </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-3 py-2 border-t text-[11px] text-[var(--text-2)]"
        style={{
          background: "rgba(26, 26, 36, 0.55)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {packs.length} packs
      </div>
    </div>
  );
}
