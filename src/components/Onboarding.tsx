import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<"ai-setup" | "permissions" | "ready">("ai-setup");
  const [axGranted, setAxGranted] = useState(false);
  const [checking, setChecking] = useState(false);

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

  // Poll for accessibility permission every 2s when on that step
  useEffect(() => {
    if (step !== "permissions") return;
    checkAx();
    const interval = setInterval(checkAx, 2000);
    return () => clearInterval(interval);
  }, [step, checkAx]);

  // ── Step 1: AI Setup ──
  if (step === "ai-setup") {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
        <h1 className="text-lg font-bold mb-2">Setting up your AI engine</h1>
        <p className="text-[12px] text-[var(--text-2)] text-center mb-6 leading-relaxed max-w-[280px]">
          This runs entirely on your machine. No data leaves your computer. Ever.
        </p>

        <div
          className="w-full max-w-[280px] rounded-lg p-4 mb-6"
          style={{
            background: "var(--well-floor)",
            border: "1px solid var(--border-default)",
          }}
        >
          {/* Progress bar placeholder */}
          <div
            className="h-1.5 w-full rounded-full mb-3 overflow-hidden"
            style={{ background: "var(--border-default)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: "0%", background: "var(--accent)" }}
            />
          </div>
          <p
            className="text-center"
            style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-2)" }}
          >
            AI model will be available soon. You can start capturing now.
          </p>
        </div>

        <button
          onClick={() => setStep("permissions")}
          className="w-full max-w-[260px] py-2.5 text-sm font-medium rounded-lg transition-colors"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          Continue
        </button>
      </div>
    );
  }

  // ── Step 2: Permissions ──
  if (step === "permissions") {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
        <h1 className="text-lg font-bold mb-2">Two permissions needed</h1>
        <p
          className="text-center mb-5 leading-relaxed max-w-[280px]"
          style={{ fontSize: "var(--text-body, 13px)", color: "var(--text-2)" }}
        >
          Research Inbox needs these to capture text from other apps with ⇧⌘S.
        </p>

        {/* Accessibility card */}
        <div
          className="w-full max-w-[280px] rounded-lg p-4 mb-3"
          style={{
            background: "var(--well-floor)",
            border: "1px solid var(--border-default)",
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

        {/* Input Monitoring card */}
        <div
          className="w-full max-w-[280px] rounded-lg p-4 mb-5"
          style={{
            background: "var(--well-floor)",
            border: "1px solid var(--border-default)",
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
    );
  }

  // ── Step 3: Ready ──
  return (
    <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
      <h1 className="text-lg font-bold mb-2">Research Inbox is ready</h1>
      <p
        className="text-center mb-6 leading-relaxed max-w-[260px]"
        style={{ fontSize: "var(--text-body, 13px)", color: "var(--text-2)" }}
      >
        Use it from any app.
      </p>

      <div
        className="rounded-lg px-6 py-4 mb-6 text-center"
        style={{
          background: "var(--well-floor)",
          border: "1px solid var(--border-default)",
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
  );
}
