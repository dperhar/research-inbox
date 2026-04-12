import { useState, useEffect } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { CaptureItem, AgentLogEntry } from "../types";
import AskBar from "./AskBar";
import AgentLog from "./AgentLog";
import ExportPreview from "./ExportPreview";

export default function PackView() {
  const { editingPack, setEditingPack, showToast, loadPacks } = useStore();
  const [packItems, setPackItems] = useState<CaptureItem[]>([]);
  const [itemIds, setItemIds] = useState<string[]>(editingPack?.item_ids || []);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [saving, setSaving] = useState(false);

  // Parse agent_log from pack
  useEffect(() => {
    if (!editingPack) return;
    setItemIds(editingPack.item_ids);
    if (editingPack.agent_log) {
      setAgentLog(Array.isArray(editingPack.agent_log) ? editingPack.agent_log : []);
    }
  }, [editingPack?.id]);

  // Load actual item objects whenever itemIds changes
  useEffect(() => {
    if (itemIds.length === 0) {
      setPackItems([]);
      return;
    }
    api.listItems(0, 200, false, null, null).then((all) => {
      const map = new Map(all.map((i) => [i.id, i]));
      const ordered = itemIds.map((id) => map.get(id)).filter(Boolean) as CaptureItem[];
      setPackItems(ordered);
    });
  }, [itemIds]);

  if (!editingPack) return null;

  const removeItem = (id: string) => {
    setItemIds((prev) => prev.filter((i) => i !== id));
  };

  const handleSave = async () => {
    if (!editingPack.id) return;
    setSaving(true);
    try {
      await api.updatePack(
        editingPack.id,
        editingPack.title,
        editingPack.description ?? null,
        editingPack.constraints ?? null,
        editingPack.questions ?? null,
        itemIds,
        editingPack.export_format,
      );
      showToast("Pack updated");
      await loadPacks();
    } catch {
      showToast("Error saving pack");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!editingPack.id) return;
    try {
      const exported = await api.exportPack(editingPack.id, editingPack.export_format);
      await writeText(exported);
      showToast(`Copied ${packItems.length} items to clipboard`);
    } catch {
      showToast("Error copying pack");
    }
  };

  const handleSaveAsFile = async () => {
    if (!editingPack.id) return;
    try {
      const exported = await api.exportPack(editingPack.id, editingPack.export_format);
      const slug = editingPack.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filePath = await save({
        defaultPath: `${slug || "context-pack"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, exported);
        showToast(`Saved to ${filePath}`);
      }
    } catch {
      showToast("Error saving file");
    }
  };

  const handleChat = async (instruction: string) => {
    if (!editingPack.id) return;
    const optimisticUser: AgentLogEntry = {
      ts: new Date().toISOString(),
      role: "user",
      content: instruction,
    };
    setAgentLog((prev) => [...prev, optimisticUser]);

    try {
      const result = await api.chatPackAgent(editingPack.id, instruction);
      const aiEntry: AgentLogEntry = {
        ts: new Date().toISOString(),
        role: "ai",
        content: result.diff_summary || "Done.",
      };
      setAgentLog((prev) => [...prev, aiEntry]);

      if (Array.isArray(result.item_ids)) {
        setItemIds(result.item_ids);
      }
      showToast(result.diff_summary || "Pack updated");
    } catch (err: any) {
      const errEntry: AgentLogEntry = {
        ts: new Date().toISOString(),
        role: "ai",
        content: "Error: " + (err?.toString() || "unknown"),
      };
      setAgentLog((prev) => [...prev, errEntry]);
      showToast("Chat error");
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--well-void)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
        style={{
          background: "var(--well-wall)",
          borderColor: "var(--border-default)",
        }}
        data-tauri-drag-region
      >
        <button
          onClick={() => setEditingPack(null)}
          className="transition-opacity hover:opacity-70 flex-shrink-0"
          style={{ color: "var(--text-2)" }}
          title="Back"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <h1
          className="flex-1 text-sm font-semibold truncate"
          style={{ color: "var(--text-1)" }}
          data-tauri-drag-region
        >
          {editingPack.title}
        </h1>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{
            background: "var(--accent)",
            color: "#fff",
          }}
        >
          {saving ? "Saving..." : "Update"}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Summary card */}
        {editingPack.description && (
          <div
            className="rounded-lg px-3 py-2.5"
            style={{
              background: "var(--well-floor)",
              border: "1px solid var(--border-subtle, var(--border-default))",
            }}
          >
            <p
              className="text-[11px] font-semibold uppercase tracking-wide mb-1"
              style={{ color: "var(--text-3, var(--text-secondary))" }}
            >
              Summary
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-1)" }}>
              {editingPack.description}
            </p>
          </div>
        )}

        {/* Meta badges */}
        {editingPack.meta && (editingPack.meta.audience || editingPack.meta.tone) && (
          <div className="flex items-center gap-2 flex-wrap">
            {editingPack.meta.audience && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: "var(--accent-muted, rgba(99,102,241,0.12))",
                  color: "var(--accent)",
                }}
              >
                {editingPack.meta.audience}
              </span>
            )}
            {editingPack.meta.tone && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: "var(--well-floor)",
                  color: "var(--text-2)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {editingPack.meta.tone}
              </span>
            )}
          </div>
        )}

        {/* Evidence items */}
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--text-3, var(--text-secondary))" }}
          >
            Evidence ({packItems.length} items)
          </p>
          <div className="space-y-1.5">
            {packItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 px-2.5 py-2 rounded-lg"
                style={{
                  background: "var(--surface-card, var(--well-floor))",
                  border: "1px solid var(--border-subtle, var(--border-default))",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[10px] mb-0.5"
                    style={{ color: "var(--text-3, var(--text-secondary))" }}
                  >
                    {item.source_app} &middot;{" "}
                    {new Date(item.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p
                    className="text-xs leading-relaxed line-clamp-3"
                    style={{ color: "var(--text-1)" }}
                  >
                    {item.content.slice(0, 180)}
                    {item.content.length > 180 ? "..." : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="flex-shrink-0 transition-opacity hover:opacity-70 mt-0.5"
                  style={{ color: "var(--text-3, var(--text-secondary))" }}
                  title="Remove from pack"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {packItems.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-3, var(--text-secondary))" }}>
                No items in this pack.
              </p>
            )}
          </div>
        </div>

        {/* Agent Log */}
        {agentLog.length > 0 && <AgentLog entries={agentLog} />}

        {/* Export Preview */}
        {editingPack.id && (
          <ExportPreview
            packId={editingPack.id}
            initialFormat={editingPack.export_format}
            itemCount={packItems.length}
          />
        )}
      </div>

      {/* Chat bar */}
      <div
        className="px-3 py-2 border-t flex-shrink-0"
        style={{
          background: "var(--well-wall)",
          borderColor: "var(--border-default)",
        }}
      >
        <AskBar
          activePack={{ id: editingPack.id, title: editingPack.title }}
          onSearch={() => {}}
          onIntent={() => {}}
          onChat={handleChat}
          onAsk={async () => {}}
        />
      </div>

      {/* Action buttons */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-t flex-shrink-0"
        style={{
          background: "var(--well-floor)",
          borderColor: "var(--border-default)",
        }}
      >
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-opacity hover:opacity-80 flex-1 justify-center"
          style={{
            background: "var(--well-wall)",
            color: "var(--text-1)",
            border: "1px solid var(--border-default)",
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </button>
        <button
          onClick={handleSaveAsFile}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-opacity hover:opacity-80 flex-1 justify-center"
          style={{
            background: "var(--well-wall)",
            color: "var(--text-1)",
            border: "1px solid var(--border-default)",
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Save as File
        </button>
      </div>
    </div>
  );
}
