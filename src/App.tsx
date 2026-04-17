import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "./lib/store";
import { setLanguage } from "./lib/i18n";
import Toast from "./components/Toast";
import InboxPanel from "./components/InboxPanel";
import PackView from "./components/PackView";
import Settings from "./components/Settings";
import PacksList from "./components/PacksList";
import Onboarding from "./components/Onboarding";

export default function App() {
  const { view, loadItems, loadSettings, loadTags, settings } = useStore();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Apply theme to document root (reactive – updates when settings change).
  // Default to "dark" immediately so the first paint matches the Well design
  // rather than flashing whatever the OS theme happens to be.
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      settings?.theme || "dark",
    );
  }, [settings?.theme]);

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

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const timer = window.setTimeout(() => {
      currentWindow.show().catch(() => {});
      currentWindow.unminimize().catch(() => {});
      currentWindow.setFocus().catch(() => {});
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  // §4.3 Inbox mobility — persist panel position on move. Rust clamps and
  // restores it before the window becomes visible again.
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = currentWindow.onMoved(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const visible = await currentWindow.isVisible();
          if (!visible) return;
          const pos = await currentWindow.outerPosition();
          const scale = await currentWindow.scaleFactor();
          await invoke("save_window_position", {
            label: "panel",
            x: pos.x / scale,
            y: pos.y / scale,
          });
        } catch {}
      }, 220);
    });
    return () => {
      if (timer) clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("ri-onboarded", "true");
    setOnboarded(true);
  };

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

  const content = (
    <>
      {(view === "inbox" || view === "topics") && <InboxPanel />}
      {view === "packs" && <PacksList />}
      {view === "pack-view" && <PackView />}
      {view === "settings" && <Settings />}
    </>
  );

  return (
    <div className="panel-stage text-[var(--text-1)]">
      <Toast />
      <div className="panel-shell">
        {content}
      </div>
    </div>
  );
}
