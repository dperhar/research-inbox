import { useState, useEffect } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { CaptureItem, ExportFormat } from "../types";
import TagInput from "./TagInput";

export default function PackEditor() {
  const { editingPack, setEditingPack, showToast, loadPacks, items: allItems } = useStore();
  const [title, setTitle] = useState(editingPack?.title || "");
  const [description, setDescription] = useState(editingPack?.description || "");
  const [constraints, setConstraints] = useState(editingPack?.constraints || "");
  const [questions, setQuestions] = useState(editingPack?.questions || "");
  const [format, setFormat] = useState<ExportFormat>((editingPack?.export_format as ExportFormat) || "markdown");
  const [itemIds, setItemIds] = useState<string[]>(editingPack?.item_ids || []);
  const [packItems, setPackItems] = useState<CaptureItem[]>([]);

  useEffect(() => {
    // Load the actual items for the pack
    const loadPackItems = async () => {
      const loaded = await api.listItems(0, 200, false, null, null);
      const filtered = loaded.filter((i) => itemIds.includes(i.id));
      // Maintain order from itemIds
      const ordered = itemIds.map((id) => filtered.find((i) => i.id === id)).filter(Boolean) as CaptureItem[];
      setPackItems(ordered);
    };
    loadPackItems();
  }, [itemIds]);

  const handleSave = async () => {
    try {
      if (editingPack?.id) {
        await api.updatePack(editingPack.id, title, description, constraints, questions, itemIds, format);
      } else {
        await api.createPack(title, description || null, constraints || null, questions || null, itemIds, format);
      }
      showToast(`✓ ${t("save_pack")}`);
      await loadPacks();
      setEditingPack(null);
    } catch (err) {
      showToast("Error saving pack");
    }
  };

  const handleCopyToClipboard = async () => {
    try {
      let packId = editingPack?.id;
      if (!packId) {
        const pack = await api.createPack(title, description || null, constraints || null, questions || null, itemIds, format);
        packId = pack.id;
        await loadPacks();
      }
      const exported = await api.exportPack(packId, format);
      await writeText(exported);
      showToast(`✓ ${t("pack_copied", { count: packItems.length })}`);
    } catch (err) {
      showToast("Error exporting pack");
    }
  };

  const handleSaveAsFile = async () => {
    try {
      let packId = editingPack?.id;
      if (!packId) {
        const pack = await api.createPack(title, description || null, constraints || null, questions || null, itemIds, format);
        packId = pack.id;
        await loadPacks();
      }
      const exported = await api.exportPack(packId, format);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const filePath = await save({
        defaultPath: `${slug || "context-pack"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, exported);
        showToast(`✓ Saved to ${filePath}`);
      }
    } catch (err) {
      showToast("Error saving file");
    }
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const newIds = [...itemIds];
    const target = index + direction;
    if (target < 0 || target >= newIds.length) return;
    [newIds[index], newIds[target]] = [newIds[target], newIds[index]];
    setItemIds(newIds);
  };

  const removeItem = (id: string) => {
    setItemIds(itemIds.filter((i) => i !== id));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-default)] bg-[var(--well-wall)] flex items-center gap-2">
        <button onClick={() => setEditingPack(null)} className="text-[var(--text-2)] hover:text-[var(--text-1)]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium">{editingPack?.id ? t("edit_pack") : t("new_pack")}</span>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("pack_title")}
          className="w-full px-2.5 py-1.5 bg-[var(--surface-input)] border border-[var(--border-default)] rounded-md text-sm outline-none focus:border-[var(--accent)]"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("pack_description")}
          rows={2}
          className="w-full px-2.5 py-1.5 bg-[var(--surface-input)] border border-[var(--border-default)] rounded-md text-xs outline-none focus:border-[var(--accent)] resize-none"
        />

        {/* Items */}
        <div>
          <div className="text-[11px] text-[var(--text-2)] mb-1 font-medium">
            Evidence ({packItems.length} items)
          </div>
          <div className="space-y-1">
            {packItems.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-1 p-1.5 bg-[var(--surface-card)] rounded border border-[var(--border-subtle)]">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveItem(idx, -1)} className="text-[var(--text-2)] hover:text-[var(--text-1)] text-[10px]">▲</button>
                  <button onClick={() => moveItem(idx, 1)} className="text-[var(--text-2)] hover:text-[var(--text-1)] text-[10px]">▼</button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[var(--text-2)]">{item.source_app} · {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-xs truncate selectable">{item.content.slice(0, 80)}...</div>
                </div>
                <button onClick={() => removeItem(item.id)} className="text-[var(--text-2)] hover:text-[var(--signal-error)] text-xs">&times;</button>
              </div>
            ))}
          </div>
        </div>

        <textarea
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder={t("pack_constraints")}
          rows={2}
          className="w-full px-2.5 py-1.5 bg-[var(--surface-input)] border border-[var(--border-default)] rounded-md text-xs outline-none focus:border-[var(--accent)] resize-none"
        />
        <textarea
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
          placeholder={t("pack_questions")}
          rows={2}
          className="w-full px-2.5 py-1.5 bg-[var(--surface-input)] border border-[var(--border-default)] rounded-md text-xs outline-none focus:border-[var(--accent)] resize-none"
        />

        {/* Format selector */}
        <div>
          <div className="text-[11px] text-[var(--text-2)] mb-1 font-medium">{t("export_format")}</div>
          <div className="flex gap-1">
            {(["markdown", "claude", "chatgpt", "cursor"] as ExportFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${format === f ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-input)] text-[var(--text-2)] hover:bg-[var(--border-default)]"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-[var(--border-default)] bg-[var(--well-rim)] flex gap-2">
        <button onClick={handleCopyToClipboard} className="flex-1 px-2 py-1.5 bg-[var(--accent)] text-white text-xs font-medium rounded-md hover:bg-[var(--accent-hover)] transition-colors">
          {t("copy_to_clipboard")}
        </button>
        <button onClick={handleSaveAsFile} className="px-2 py-1.5 bg-[var(--surface-input)] text-[var(--text-1)] text-xs font-medium rounded-md border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-colors">
          {t("save_as_file")}
        </button>
        <button onClick={handleSave} className="px-2 py-1.5 bg-[var(--surface-input)] text-[var(--text-1)] text-xs font-medium rounded-md border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-colors">
          {t("save_pack")}
        </button>
      </div>
    </div>
  );
}
