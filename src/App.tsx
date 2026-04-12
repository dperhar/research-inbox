import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./lib/store";
import { api } from "./lib/ipc";
import { setLanguage } from "./lib/i18n";
import Toast from "./components/Toast";
import InboxPanel from "./components/InboxPanel";
import PackEditor from "./components/PackEditor";
import Settings from "./components/Settings";
import PacksList from "./components/PacksList";
import Onboarding from "./components/Onboarding";
import type { AppInfo } from "./types";

export default function App() {
  const { view, loadItems, loadSettings, loadTags, showToast, settings } = useStore();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Apply theme to document root
  useEffect(() => {
    api.getSettings()
      .then((s) => {
        document.documentElement.setAttribute("data-theme", s.theme ?? "dark");
      })
      .catch(() => {
        document.documentElement.setAttribute("data-theme", "dark");
      });
  }, []);

  // Check if onboarding was completed
  useEffect(() => {
    const done = localStorage.getItem("ri-onboarded");
    setOnboarded(done === "true");
    loadItems();
    loadSettings();
    loadTags();
  }, []);

  useEffect(() => {
    if (settings?.language) setLanguage(settings.language);
  }, [settings?.language]);

  const completeOnboarding = () => {
    localStorage.setItem("ri-onboarded", "true");
    setOnboarded(true);
  };

  // ⇧⌘S capture — tries selected text first (no clipboard touch), falls back to clipboard
  useEffect(() => {
    const unlisten = listen<string>("capture-triggered", async (event) => {
      try {
        let appName = "Clipboard";
        let windowTitle = "";
        let urlFromTitle: string | null = null;
        let selectedText: string | null = null;

        try {
          if (event.payload) {
            const data = JSON.parse(event.payload);
            appName = data.app_name || "Clipboard";
            windowTitle = data.window_title || "";
            urlFromTitle = data.url_from_title || null;
            selectedText = data.selected_text || null;
          }
        } catch {}

        // Use selected text if available, otherwise fall back to clipboard
        let content = selectedText;
        if (!content || content.trim() === "") {
          content = await readText();
        }

        if (!content || content.trim() === "") {
          showToast("Nothing selected or in clipboard");
          return;
        }

        const maxSize = (settings?.max_capture_size_kb || 50) * 1024;
        if (content.length > maxSize) content = content.slice(0, maxSize);

        const isDup = await invoke<boolean>("check_duplicate", { content });
        if (isDup) {
          showToast("Already captured");
          return;
        }

        await api.capture(content, appName, urlFromTitle, windowTitle || null, []);

        const preview = content.slice(0, 40);
        const source = selectedText ? appName : "clipboard";
        showToast(`Captured from ${source}: "${preview}..."`);
        loadItems();
        loadTags();
      } catch {
        showToast("Capture failed");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [settings]);

  // Screenshot capture
  useEffect(() => {
    const unlisten = listen("screenshot-triggered", async () => {
      try {
        showToast("Select a screen region...");
        const item = await invoke<any>("capture_screenshot", { tags: [] });
        const preview = item.content.slice(0, 40);
        showToast(`Screenshot from ${item.source_app}: "${preview}..."`);
        loadItems();
        loadTags();
      } catch (err: any) {
        if (err?.toString().includes("cancelled")) {
          showToast("Screenshot cancelled");
        } else {
          showToast(`Screenshot failed: ${err}`);
        }
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Escape to navigate back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const { view, setView, setExpanded, expandedId } = useStore.getState();
        if (expandedId) setExpanded(null);
        else if (view !== "inbox") setView("inbox");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Reload items when panel becomes visible
  useEffect(() => {
    const handleFocus = () => {
      const { loadItems, loadTags, showArchived } = useStore.getState();
      loadItems(showArchived);
      loadTags();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Loading
  if (onboarded === null) return null;

  // Onboarding
  if (!onboarded) {
    return <Onboarding onComplete={completeOnboarding} />;
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <Toast />
      {view === "inbox" && <InboxPanel />}
      {view === "packs" && <PacksList />}
      {view === "pack-editor" && <PackEditor />}
      {view === "settings" && <Settings />}
    </div>
  );
}
