"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { takeSignupIntent, type SignupIntent } from "@/lib/auth/signup-intent";
import { Loader2 } from "lucide-react";

/**
 * The one-time "who are you?" step.
 *
 * A full page rather than a card on the landing, because the answer decides
 * whether someone ever gets offered the CRM, and a dismissible card meant a
 * share of users simply never answered. Both entry points into the product
 * redirect here while signup_intent is null, so there is no way around it
 * short of not signing in.
 *
 * Choosing "introducing broker" records a REQUEST, never a role. The user keeps
 * journal-only access until an admin approves, so this cannot self-grant the
 * CRM. See record_signup_intent(), which is write-once and validates its own
 * input.
 */
export function WelcomeGate({ firstName }: { readonly firstName: string }) {
  const [busy, setBusy] = useState<SignupIntent | null>(null);
  const [done, setDone] = useState<SignupIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const choose = useCallback(
    async (intent: SignupIntent) => {
      setBusy(intent);
      setError(null);
      const { error: rpcError } = await createClient().rpc("record_signup_intent", {
        p_intent: intent,
      });
      setBusy(null);

      if (rpcError) {
        // Surfaced rather than swallowed: this page is a gate, so failing
        // silently would strand the user on it with no way forward.
        setError("We could not save that. Please try again.");
        return;
      }

      setDone(intent);
      // replace, not push: the gate must not sit in history where Back would
      // return to a step that is already answered and would just bounce.
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, intent === "ib" ? 2200 : 900);
    },
    [router],
  );

  // Someone who answered on the sign-up form already decided. Apply it and move
  // on rather than asking the same question twice.
  useEffect(() => {
    const stashed = takeSignupIntent();
    if (stashed) void choose(stashed);
  }, [choose]);

  if (done !== null) {
    return (
      <div className="welcome-card welcome-done">
        <p className="welcome-q">
          {done === "ib" ? "Thanks. We'll review your partner access." : "Perfect. Your journal is ready."}
        </p>
        {done === "ib" && (
          <p className="welcome-sub">
            Your Trade Journal is ready now. The Affiliate CRM appears once an FXU admin
            approves you.
          </p>
        )}
        <Loader2 className="size-4 animate-spin welcome-spin" />
      </div>
    );
  }

  return (
    <div className="welcome-card">
      <p className="welcome-q">One quick thing, {firstName}: what brings you to FXU?</p>
      <p className="welcome-sub">
        This decides which apps we set up for you. You can only answer once.
      </p>

      <div className="welcome-options">
        <button
          className="welcome-opt"
          onClick={() => choose("trader")}
          disabled={busy !== null}
        >
          <strong>I trade my own account</strong>
          <span>Journal, analytics and the calculators</span>
        </button>
        <button
          className="welcome-opt"
          onClick={() => choose("ib")}
          disabled={busy !== null}
        >
          <strong>I introduce clients</strong>
          <span>Also request the Affiliate CRM</span>
        </button>
      </div>

      {busy !== null && (
        <p className="welcome-sub welcome-busy">
          <Loader2 className="size-3.5 animate-spin" /> Setting things up
        </p>
      )}
      {error !== null && <p className="welcome-error">{error}</p>}

      <p className="welcome-foot">
        Either way your Trade Journal is ready straight away. The Affiliate CRM opens
        once an FXU admin approves you.
      </p>
    </div>
  );
}
