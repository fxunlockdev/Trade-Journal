"use client";

import { useCallback, useEffect, useState } from "react";
import type { JournalWithRole } from "@/types/database";

/**
 * Client-side journals list hook. Fetches `/api/journals` on mount and
 * returns ordered active journals + the caller's role in each. Used by the
 * trade-form journal picker.
 */

interface UseJournalsReturn {
  readonly journals: readonly JournalWithRole[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => Promise<void>;
}

interface Payload {
  readonly data?: readonly JournalWithRole[];
  readonly error?: string;
}

export function useJournals(): UseJournalsReturn {
  const [journals, setJournals] = useState<readonly JournalWithRole[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/journals", { cache: "no-store" });
      const body = (await res.json()) as Payload;
      if (!res.ok) {
        setError(body.error ?? "Failed to load journals");
        setJournals([]);
        return;
      }
      setJournals(body.data ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
      setJournals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) setJournals([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Journals now carry `current_balance`, which the trade form sizes positions
  // from — so a mount-only fetch goes stale in every case where the form stays
  // open: another member logs a trade, an MT5 webhook closes a position, or a
  // second tab. Refreshing when the tab regains focus keeps the sizing basis
  // close to reality without polling.
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  return { journals, loading, error, refetch: load };
}
