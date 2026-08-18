"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The one-time "who are you?" question.
 *
 * Asked after the first sign-in rather than inside the signup form, because
 * Google OAuth leaves the page mid-flow and any answer collected beforehand
 * would be lost. Here it works identically for both sign-up paths.
 *
 * Choosing "introducing broker" records a REQUEST, not a role. The user keeps
 * journal-only access until an admin approves, so this cannot be used to
 * self-grant the CRM.
 */
export function IntentPrompt({ firstName }: { firstName: string }) {
  const [busy, setBusy] = useState<"trader" | "ib" | null>(null);
  const [done, setDone] = useState<"trader" | "ib" | null>(null);
  const router = useRouter();

  async function choose(intent: "trader" | "ib") {
    setBusy(intent);
    const { error } = await createClient().rpc("record_signup_intent", { p_intent: intent });
    setBusy(null);
    if (error) return;
    setDone(intent);
    // Traders are finished; refresh so the prompt drops away.
    if (intent === "trader") setTimeout(() => router.refresh(), 900);
  }

  if (done === "ib") {
    return (
      <div className="intent intent-done">
        <p className="intent-q">Thanks. We&apos;ll review your partner access.</p>
        <p className="intent-sub">
          Your Trade Journal is ready now. The Affiliate CRM appears here once an FXU admin
          approves you.
        </p>
      </div>
    );
  }
  if (done === "trader") {
    return (
      <div className="intent intent-done">
        <p className="intent-q">Perfect. Your journal is ready.</p>
      </div>
    );
  }

  return (
    <div className="intent">
      <p className="intent-q">One quick thing, {firstName}: what brings you to FXU?</p>
      <div className="intent-options">
        <button className="intent-opt" onClick={() => choose("trader")} disabled={busy !== null}>
          <strong>I trade my own account</strong>
          <span>Journal, analytics and the calculators</span>
        </button>
        <button className="intent-opt" onClick={() => choose("ib")} disabled={busy !== null}>
          <strong>I introduce clients</strong>
          <span>Also request the Affiliate CRM</span>
        </button>
      </div>
    </div>
  );
}
