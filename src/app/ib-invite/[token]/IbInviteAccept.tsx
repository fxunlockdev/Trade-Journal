"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "@/app/_home/fxu-home.css";

type State =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/** Posts the IB invite token once and shows the outcome in FXU Home styling. */
export function IbInviteAccept({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ib-invite/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        setState(res.ok ? { kind: "ok" } : { kind: "error", message: data.error ?? "Could not accept invite." });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Something went wrong." });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="fxu-home auth-page">
      <div className="orbs" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
      </div>
      <div className="auth-inner">
        {state.kind === "loading" && (
          <>
            <h1 className="auth-title">Setting up your <span className="grad-text">access…</span></h1>
            <p className="auth-sub">One moment.</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <h1 className="auth-title">You&apos;re an <span className="grad-text">IB.</span></h1>
            <p className="auth-sub">
              The Affiliate CRM is now unlocked alongside your Trade Journal.
            </p>
            <Link className="btn-primary" href="/">Go to FXU Home</Link>
          </>
        )}
        {state.kind === "error" && (
          <>
            <h1 className="auth-title">Invite couldn&apos;t be <span className="grad-text">accepted.</span></h1>
            <p className="auth-sub">{state.message}</p>
            <Link className="btn-primary" href="/">Go to FXU Home</Link>
          </>
        )}
      </div>
    </div>
  );
}
