"use client";

import { useEffect } from "react";

/**
 * Sync-on-visit: keeps Myfxbook-linked accounts fresh WITHOUT any cron
 * dependency. On app load (once per 15 min per browser tab session), fetch
 * the user's connections and fire-and-forget a sync for any stale one.
 * The server's own staleness/last_error handling makes over-firing harmless,
 * and an external cron (if configured) simply makes this a no-op.
 */

const THROTTLE_KEY = "trdr:myfxbook-auto-sync-at";
const THROTTLE_MS = 15 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

interface ConnectionRow {
  readonly id: string;
  readonly last_sync_at: string | null;
  readonly revoked_at: string | null;
  readonly last_error: string | null;
}

export function MyfxbookAutoSync() {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem(THROTTLE_KEY) ?? 0);
      if (Date.now() - last < THROTTLE_MS) return;
      sessionStorage.setItem(THROTTLE_KEY, String(Date.now()));
    } catch {
      // sessionStorage unavailable (private mode) — still proceed once.
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/myfxbook/connections", {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: readonly ConnectionRow[] };
        const due = (json.data ?? []).filter((c) => {
          if (c.revoked_at) return false;
          if (!c.last_sync_at) return true;
          return Date.now() - new Date(c.last_sync_at).getTime() > STALE_MS;
        });
        // Fire-and-forget; the sync route itself is idempotent + throttled by
        // Myfxbook's own update cadence. Sequential to respect rate limits.
        for (const c of due.slice(0, 3)) {
          await fetch(`/api/myfxbook/connections/${c.id}/sync`, {
            method: "POST",
            signal: controller.signal,
          }).catch(() => {});
        }
      } catch {
        // Background nicety — never surface errors.
      }
    })();

    return () => controller.abort();
  }, []);

  return null;
}
