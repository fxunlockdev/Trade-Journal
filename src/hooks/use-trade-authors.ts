"use client";

import { useEffect, useState } from "react";

/**
 * Fetch display info for every trade author in the active journal. Used by
 * the trade table to render "logged by Alice" badges in shared workspaces.
 *
 * Returns a map of user_id → display info. Missing users (e.g. deleted
 * accounts) just fall back to "Unknown" at render time.
 */

interface AuthorInfo {
  readonly user_id: string;
  readonly email: string;
  readonly full_name: string;
  readonly avatar_url: string;
}

interface UseTradeAuthorsReturn {
  readonly authors: Readonly<Record<string, AuthorInfo>>;
  readonly loading: boolean;
}

interface Payload {
  readonly data?: readonly AuthorInfo[];
  readonly error?: string;
}

export function useTradeAuthors(journalId: string | null): UseTradeAuthorsReturn {
  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!journalId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Use the RPC via Supabase REST — simpler: just fetch from our own
        // members endpoint for this journal (returns all members, which is
        // a superset of trade authors).
        const res = await fetch(`/api/journals/${journalId}/members`, {
          cache: "no-store",
        });
        const body = (await res.json()) as Payload;
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setLoading(false);
          return;
        }
        const map: Record<string, AuthorInfo> = {};
        for (const row of body.data) {
          map[row.user_id] = row;
        }
        setAuthors(map);
      } catch {
        // swallow — badges just won't show
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journalId]);

  return { authors, loading };
}
