import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<"welcome" | "accessibility" | "done">("welcome");
  const [axGranted, setAxGranted] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkAx = useCallback(async () => {
    setChecking(true);
    try {
      const granted = await invoke<boolean>("check_accessibility");
      setAxGranted(granted);
      // Don't auto-skip — user must confirm they enabled BOTH permissions
    } catch {
      setAxGranted(false);
    }
    setChecking(false);
  }, [step]);

  // Poll for accessibility permission every 2s when on that step
  useEffect(() => {
    if (step !== "accessibility") return;
    checkAx();
    const interval = setInterval(checkAx, 2000);
    return () => clearInterval(interval);
  }, [step, checkAx]);

  const openSettings = async () => {
    await invoke("open_accessibility_settings");
  };

  if (step === "welcome") {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
        <div className="text-3xl mb-3">🔗</div>
        <h1 className="text-lg font-bold mb-1">Research Inbox</h1>
        <p className="text-[13px] text-[var(--text-2)] text-center mb-6 max-w-[260px]">
          Capture once. Reuse everywhere.<br />
          No more re-collecting the same info twice.
        </p>

        <div className="w-full max-w-[260px] space-y-4 mb-7">
          <div className="flex items-center gap-3">
            <kbd className="px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[11px] font-mono font-bold shrink-0">⇧⌘S</kbd>
            <p className="text-[12px] leading-snug">Saves selected text + offers screenshot</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--surface-input)] border border-[var(--border-default)] flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <p className="text-[12px] leading-snug">Context Packs — living docs you update, not rebuild</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--surface-input)] border border-[var(--border-default)] flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <p className="text-[12px] leading-snug">Share with colleagues, present on a call, or feed to AI</p>
          </div>
        </div>

        <button
          onClick={() => setStep("accessibility")}
          className="w-full max-w-[260px] py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
        >
          Set up permissions →
        </button>
      </div>
    );
  }

  if (step === "accessibility") {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
        <div className="text-4xl mb-4">🔐</div>
        <h1 className="text-lg font-bold mb-2">Two permissions needed</h1>
        <p className="text-sm text-[var(--text-2)] text-center mb-5 leading-relaxed max-w-[280px]">
          RI needs these to capture text from other apps with ⇧⌘S.
        </p>

        <div className="w-full max-w-[280px] bg-[var(--well-floor)] rounded-lg p-4 mb-3 space-y-1.5">
          <p className="text-xs font-semibold text-[var(--accent)]">1. Accessibility</p>
          <p className="text-[11px] text-[var(--text-2)]">Open → find Research Inbox → toggle ON</p>
        </div>
        <div className="w-full max-w-[280px] bg-[var(--well-floor)] rounded-lg p-4 mb-5 space-y-1.5">
          <p className="text-xs font-semibold text-[var(--accent)]">2. Input Monitoring</p>
          <p className="text-[11px] text-[var(--text-2)]">Open → click <strong>+</strong> → select <strong>Research Inbox</strong> from Applications → toggle ON</p>
        </div>

        <div className="flex flex-col items-center gap-2 w-full max-w-[260px]">
          <button
            onClick={openSettings}
            className="w-full py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
          >
            Open Accessibility
          </button>
          <button
            onClick={() => invoke("open_input_monitoring_settings")}
            className="w-full py-2.5 bg-[var(--well-floor)] border border-[var(--border-default)] text-[var(--text-1)] text-sm font-medium rounded-lg hover:bg-[var(--border-default)] transition-colors"
          >
            Open Input Monitoring
          </button>

          {axGranted ? (
            <div className="flex items-center gap-2 text-emerald-500 font-medium text-sm mt-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Accessibility granted
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-2)] mt-2">
              {checking ? "Checking..." : "Waiting for permissions..."}
            </p>
          )}

          <button
            onClick={() => setStep("done")}
            className="w-full py-2.5 mt-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors"
          >
            I've enabled both →
          </button>
          <button
            onClick={onComplete}
            className="text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // done
  return (
    <div className="h-screen flex flex-col items-center justify-center px-8 bg-[var(--well-void)] text-[var(--text-1)]">
      <div className="text-4xl mb-4">✅</div>
      <h1 className="text-lg font-bold mb-2">You're all set!</h1>
      <p className="text-sm text-[var(--text-2)] text-center mb-6 leading-relaxed max-w-[280px]">
        Select text in any app and press <strong>⇧⌘S</strong> to capture it.
        The overlay will appear at the top of your screen.
      </p>

      <div className="bg-[var(--well-floor)] rounded-lg px-4 py-3 mb-6 text-center">
        <kbd className="text-lg font-mono font-bold text-[var(--accent)]">⇧⌘S</kbd>
        <p className="text-[11px] text-[var(--text-2)] mt-1">Your capture hotkey</p>
      </div>

      <button
        onClick={onComplete}
        className="w-full max-w-[260px] py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
      >
        Start capturing
      </button>
    </div>
  );
}
