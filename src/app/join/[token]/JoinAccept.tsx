"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type State =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * Posts the join token to /api/crm/join exactly once and shows the outcome.
 * All validation (expiry, revocation, single-use, self-accept, one-active-IB)
 * happens server-side in the SECURITY DEFINER function.
 */
export function JoinAccept({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/crm/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        if (res.ok) setState({ kind: "ok" });
        else setState({ kind: "error", message: data.error ?? "Could not accept invite." });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Something went wrong." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {state.kind === "loading" && (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Accepting your invitation…</p>
        </>
      )}
      {state.kind === "ok" && (
        <>
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re connected</h1>
          <p className="text-muted-foreground">
            Your account is linked to your partner. Head to your journal to start logging trades.
          </p>
          <Link href="/dashboard" className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
            Go to my journal
          </Link>
        </>
      )}
      {state.kind === "error" && (
        <>
          <XCircle className="h-10 w-10 text-destructive" />
          <h1 className="text-2xl font-semibold tracking-tight">Invite couldn&apos;t be accepted</h1>
          <p className="text-muted-foreground">{state.message}</p>
          <Link href="/dashboard" className="rounded-md border px-5 py-2.5 text-sm font-medium">
            Go to my journal
          </Link>
        </>
      )}
    </div>
  );
}
