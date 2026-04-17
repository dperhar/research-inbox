import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/ipc";

interface OnboardingProps {
  onComplete: () => void;
}

interface ModelStatus {
  downloaded: boolean;
  path: string;
  size_bytes: number;
  source_available: boolean;
  source_path: string | null;
  source_size_bytes: number;
}

interface HardwareStatus {
  ram_gb: number;
  meets_minimum: boolean;
}

interface ModelProgress {
  percent: number;
  downloaded: number;
  total: number;
  status: string;
  message?: string;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<"ai-setup" | "permissions" | "ready">("ai-setup");
  const [axGranted, setAxGranted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [hardware, setHardware] = useState<HardwareStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [progress, setProgress] = useState<ModelProgress>({
    percent: 0,
    downloaded: 0,
    total: 0,
    status: "idle",
  });

  const refreshModelState = useCallback(async () => {
    try {
      const [status, hw] = await Promise.all([api.checkModelStatus(), api.checkHardware()]);
      setModelStatus(status);
      setHardware(hw);
      if (status.downloaded) {
        setProgress({
          percent: 100,
          downloaded: status.size_bytes,
          total: status.size_bytes,
          status: "ready",
          message: "Model ready",
        });
      }
    } catch {
      setModelError("Could not read local model status.");
    }
  }, []);

  const checkAx = useCallback(async () => {
    setChecking(true);
    try {
      const granted = await invoke<boolean>("check_accessibility");
      setAxGranted(granted);
    } catch {
      setAxGranted(false);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    refreshModelState();
  }, [refreshModelState]);

  useEffect(() => {
    const unlisten = listen<ModelProgress>("model-download-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.status === "ready") {
        setDownloading(false);
        setModelError("");
        refreshModelState();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshModelState]);

  const handleInstallModel = useCallback(async () => {
    setDownloading(true);
    setModelError("");
    setProgress({ percent: 0, downloaded: 0, total: modelStatus?.source_size_bytes ?? 0, status: "preparing" });
    try {
      await api.downloadModel();
      await refreshModelState();
    } catch (error) {
      setDownloading(false);
      setModelError(error instanceof Error ? error.message : "Model install failed.");
    }
  }, [modelStatus?.source_size_bytes, refreshModelState]);

  // Poll for accessibility permission every 2s when on that step
  useEffect(() => {
    if (step !== "permissions") return;
    checkAx();
    const interval = setInterval(checkAx, 2000);
    return () => clearInterval(interval);
  }, [step, checkAx]);

  // ── Step 1: AI Setup ──
  if (step === "ai-setup") {
    const ready = !!modelStatus?.downloaded;
    const canInstall = !!hardware?.meets_minimum && !!modelStatus?.source_available && !downloading;
    const progressLabel =
      progress.total > 0
        ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
        : ready && modelStatus
          ? formatBytes(modelStatus.size_bytes)
          : "Waiting for install";

    return (
      <div className="panel-stage text-[var(--text-1)]">
        <div className="panel-shell flex flex-col items-center justify-center px-7 py-8 text-center">
          <p
            className="mb-3"
            style={{
              fontSize: "var(--text-metadata)",
              color: "var(--accent)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Local-First Setup
          </p>
          <h1 className="text-lg font-bold mb-2">Set up the local AI engine</h1>
          <p className="text-[12px] text-[var(--text-2)] mb-6 leading-relaxed max-w-[280px]">
            This runs entirely on your machine. No data leaves your computer. Ever.
          </p>

          <div
            className="w-full max-w-[288px] rounded-xl px-4 py-4 mb-6"
            style={{
              background: "rgba(10, 10, 15, 0.45)",
              border: "1px solid var(--border-default)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div
              className="h-1.5 w-full rounded-full mb-3 overflow-hidden"
              style={{ background: "var(--border-default)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(ready ? 100 : progress.percent, 6)}%`,
                  background: ready ? "var(--accent)" : "var(--accent)",
                  boxShadow: "var(--shadow-accent-glow)",
                }}
              />
            </div>
            <p
              className="mb-1"
              style={{ fontSize: "var(--text-metadata)", color: "var(--text-1)" }}
            >
              {ready ? "Model verified" : downloading ? progress.message || "Installing model" : "Model not installed yet"}
            </p>
            <p
              className="text-center"
              style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-2)" }}
            >
              {hardware && !hardware.meets_minimum
                ? `This Mac has ${hardware.ram_gb}GB RAM. Research Inbox needs 8GB+ for local AI.`
                : ready
                  ? `${formatBytes(modelStatus?.size_bytes ?? 0)} installed at ${modelStatus?.path}`
                  : modelStatus?.source_available
                    ? `${progressLabel} • local source ready`
                    : "No staged Gemma model source found yet."}
            </p>
          </div>

          <button
            onClick={ready ? () => setStep("permissions") : handleInstallModel}
            className="w-full max-w-[260px] py-2.5 text-sm font-medium rounded-lg transition-colors"
            disabled={!ready && !canInstall}
            style={{
              background: "var(--accent)",
              color: "#fff",
              opacity: ready || canInstall ? 1 : 0.45,
              cursor: ready || canInstall ? "pointer" : "not-allowed",
            }}
          >
            {ready ? "Continue" : downloading ? "Installing..." : "Install Local Model"}
          </button>

          {!!modelError && (
            <p
              className="mt-3 max-w-[280px]"
              style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--tag-rose-text, #f58a8a)" }}
            >
              {modelError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Step 2: Permissions ──
  if (step === "permissions") {
    return (
      <div className="panel-stage text-[var(--text-1)]">
        <div className="panel-shell flex flex-col items-center justify-center px-7 py-8 text-center">
          <p
            className="mb-3"
            style={{
              fontSize: "var(--text-metadata)",
              color: "var(--accent)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Permissions
          </p>
          <h1 className="text-lg font-bold mb-2">Two permissions needed</h1>
          <p
            className="mb-5 leading-relaxed max-w-[280px]"
            style={{ fontSize: "var(--text-secondary)", color: "var(--text-2)" }}
          >
            Research Inbox needs these to capture text from other apps with ⇧⌘S.
          </p>

          <div
            className="w-full max-w-[288px] rounded-xl p-4 mb-3 text-left"
            style={{
              background: "rgba(10, 10, 15, 0.45)",
              border: "1px solid var(--border-default)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              {axGranted ? (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                  style={{ color: "var(--accent)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                  style={{ color: "var(--text-3, var(--text-2))" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              )}
              <p
                className="font-semibold"
                style={{
                  fontSize: "var(--text-metadata, 11px)",
                  color: axGranted ? "var(--accent)" : "var(--text-1)",
                }}
              >
                1. Accessibility
                {axGranted && " – granted"}
              </p>
            </div>
            <p style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-2)" }}>
              Open → find Research Inbox → toggle ON
            </p>
          </div>

          <div
            className="w-full max-w-[288px] rounded-xl p-4 mb-5 text-left"
            style={{
              background: "rgba(10, 10, 15, 0.45)",
              border: "1px solid var(--border-default)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                style={{ color: "var(--text-3, var(--text-2))" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p
                className="font-semibold"
                style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-1)" }}
              >
                2. Input Monitoring
              </p>
            </div>
            <p style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-2)" }}>
              Open → click <strong>+</strong> → select Research Inbox → toggle ON
            </p>
          </div>

          <div className="flex flex-col items-center gap-2 w-full max-w-[260px]">
            <button
              onClick={() => invoke("open_accessibility_settings")}
              className="w-full py-2.5 text-sm font-medium rounded-lg transition-colors"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Open Accessibility
            </button>
            <button
              onClick={() => invoke("open_input_monitoring_settings")}
              className="w-full py-2.5 text-sm font-medium rounded-lg transition-colors"
              style={{
                background: "var(--well-floor)",
                border: "1px solid var(--border-default)",
                color: "var(--text-1)",
              }}
            >
              Open Input Monitoring
            </button>

            <p
              className="mt-2"
              style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-2)" }}
            >
              {checking ? "Checking..." : axGranted ? "Accessibility granted" : "Waiting for permissions..."}
            </p>

            <button
              onClick={() => setStep("ready")}
              className="w-full py-2.5 mt-1 text-sm font-medium rounded-lg transition-colors"
              style={{ background: "var(--accent)", color: "#fff", opacity: 0.9 }}
            >
              I've enabled both
            </button>
            <button
              onClick={onComplete}
              style={{
                fontSize: "var(--text-metadata, 11px)",
                color: "var(--text-2)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 3: Ready ──
  return (
    <div className="panel-stage text-[var(--text-1)]">
      <div className="panel-shell flex flex-col items-center justify-center px-7 py-8 text-center">
        <p
          className="mb-3"
          style={{
            fontSize: "var(--text-metadata)",
            color: "var(--accent)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Ready
        </p>
        <h1 className="text-lg font-bold mb-2">Research Inbox is ready</h1>
        <p
          className="mb-6 leading-relaxed max-w-[260px]"
          style={{ fontSize: "var(--text-secondary)", color: "var(--text-2)" }}
        >
          Use it from any app.
        </p>

        <div
          className="rounded-xl px-6 py-4 mb-6 text-center"
          style={{
            background: "rgba(10, 10, 15, 0.45)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <p
            style={{
              fontSize: "var(--text-metadata, 11px)",
              color: "var(--text-3, var(--text-2))",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Your capture hotkey
          </p>
          <kbd
            className="font-mono font-bold"
            style={{ fontSize: 28, color: "var(--accent)", letterSpacing: "0.02em" }}
          >
            ⇧⌘S
          </kbd>
        </div>

        <button
          onClick={onComplete}
          className="w-full max-w-[260px] py-2.5 text-sm font-medium rounded-lg transition-colors"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
