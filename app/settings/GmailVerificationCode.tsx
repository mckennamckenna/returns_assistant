"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { markGmailVerified } from "./actions";

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 15 * 60 * 1000;

type State =
  | { phase: "waiting" }
  | { phase: "found"; code: string }
  | { phase: "timeout" }
  | { phase: "verified" };

export function GmailVerificationCode({ initialCode }: { initialCode: string | null }) {
  const [state, setState] = useState<State>(initialCode ? { phase: "found", code: initialCode } : { phase: "waiting" });
  const [confirming, setConfirming] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(Date.now());

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    // Nothing to poll for — either a code already arrived (passed in from
    // the server render) or the user already marked it verified this
    // session (shouldn't happen on mount, but guards against re-mounts).
    if (state.phase !== "waiting") return;

    async function poll() {
      // Elapsed-time check happens on every tick, not just at setup, so a
      // tab left open past 15 minutes actually stops — not just shows a
      // timeout message while continuing to ping in the background.
      if (Date.now() - startedAtRef.current >= TIMEOUT_MS) {
        stopPolling();
        setState({ phase: "timeout" });
        return;
      }

      try {
        const res = await fetch("/api/gmail-code");
        if (!res.ok) return; // transient failure — try again next tick
        const data: { code: string | null } = await res.json();
        if (data.code) {
          stopPolling();
          setState({ phase: "found", code: data.code });
        }
      } catch {
        // Network hiccup — stay in "waiting" and try again next tick.
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  async function handleVerified() {
    setConfirming(true);
    stopPolling();
    try {
      await markGmailVerified();
      setState({ phase: "verified" });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="border border-border rounded-lg p-4 mb-6">
      <h2 className="font-semibold text-ink mb-2">Confirmation code</h2>

      {state.phase === "waiting" && (
        <p className="text-sm text-secondary">Waiting for Gmail to send us the confirmation code…</p>
      )}

      {state.phase === "timeout" && (
        <p className="text-sm text-secondary">
          Still waiting? Check that you entered the address correctly, or check your spam folder.
        </p>
      )}

      {state.phase === "found" && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <code className="flex-1 bg-page border border-border rounded-lg px-3 py-2 text-2xl font-mono tracking-wider text-ink">
              {state.code}
            </code>
            <CopyButton text={state.code} />
          </div>
          <p className="text-sm text-secondary mb-3">Paste this into Gmail&apos;s verification field, then click Verify.</p>
          <button
            type="button"
            onClick={handleVerified}
            disabled={confirming}
            className="text-sm font-medium text-page bg-ink rounded-lg px-3 py-1.5 hover:bg-ink/90 disabled:opacity-50"
          >
            {confirming ? "Saving…" : "I've entered this code in Gmail"}
          </button>
        </div>
      )}

      {state.phase === "verified" && <p className="text-sm text-secondary">Got it — setup complete.</p>}
    </div>
  );
}
