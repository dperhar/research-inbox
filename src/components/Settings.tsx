import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import type { AppSettings, ExportFormat } from "../types";

export default function Settings() {
  const { settings, loadSettings, setView, showToast } = useStore();
  const [local, setLocal] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings) setLocal({ ...settings });
  }, [settings]);

  if (!local) return null;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocal({ ...local, [key]: value });
  };

  const handleSave = async () => {
    try {
      await api.updateSettings(local);
      await loadSettings();
      showToast(`✓ ${t("save")}`);
      setView("inbox");
    } catch {
      showToast("Error saving settings");
    }
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
        <button onClick={() => setView("inbox")} className="text-[var(--text-2)] hover:text-[var(--text-1)]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium">{t("settings")}</span>
      </div>

      {/* Settings form */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <SettingRow label={t("hotkey_capture")}>
          <input
            value={local.capture_hotkey}
            onChange={(e) => update("capture_hotkey", e.target.value)}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none focus:border-[var(--accent)]"
          />
        </SettingRow>

        <SettingRow label={t("hotkey_panel")}>
          <input
            value={local.panel_hotkey}
            onChange={(e) => update("panel_hotkey", e.target.value)}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none focus:border-[var(--accent)]"
          />
        </SettingRow>

        <SettingRow label={t("quick_tag")}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local.quick_tag_on_capture}
              onChange={(e) => update("quick_tag_on_capture", e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-2)]">{local.quick_tag_on_capture ? "On" : "Off"}</span>
          </label>
        </SettingRow>

        <SettingRow label={t("default_format")}>
          <select
            value={local.default_export_format}
            onChange={(e) => update("default_export_format", e.target.value as ExportFormat)}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none"
          >
            <option value="markdown">Markdown</option>
            <option value="claude">Claude</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="cursor">Cursor</option>
          </select>
        </SettingRow>

        <SettingRow label={t("max_capture_size")}>
          <input
            type="number"
            value={local.max_capture_size_kb}
            onChange={(e) => update("max_capture_size_kb", parseInt(e.target.value) || 50)}
            min={10}
            max={500}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none focus:border-[var(--accent)]"
          />
        </SettingRow>

        <SettingRow label={t("launch_at_login")}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local.launch_at_login}
              onChange={(e) => update("launch_at_login", e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-2)]">{local.launch_at_login ? "On" : "Off"}</span>
          </label>
        </SettingRow>

        <SettingRow label={t("theme")}>
          <select
            value={local.theme}
            onChange={(e) => update("theme", e.target.value as "light" | "dark" | "system")}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none"
          >
            <option value="system">{t("system")}</option>
            <option value="light">{t("light")}</option>
            <option value="dark">{t("dark")}</option>
          </select>
        </SettingRow>

        <SettingRow label={t("language")}>
          <select
            value={local.language}
            onChange={(e) => update("language", e.target.value as "en" | "ru")}
            className="w-full px-2 py-1 text-xs bg-[var(--surface-input)] border border-[var(--border-default)] rounded outline-none"
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </SettingRow>
      </div>

      {/* Footer */}
      <div
        className="px-3 py-2 border-t flex gap-2"
        style={{
          background: "rgba(26, 26, 36, 0.55)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <button onClick={handleSave} className="flex-1 px-2 py-1.5 bg-[var(--accent)] text-white text-xs font-medium rounded-md hover:bg-[var(--accent-hover)] transition-colors">
          {t("save")}
        </button>
        <button onClick={() => setView("inbox")} className="px-2 py-1.5 bg-[var(--surface-input)] text-[var(--text-1)] text-xs font-medium rounded-md border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-colors">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-3 py-3"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="text-[11px] text-[var(--text-2)] mb-2 font-medium">{label}</div>
      {children}
    </div>
  );
}
