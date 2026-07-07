import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSyncDue, syncMyfxbookConnection } from "@/lib/myfxbook/sync";
import type { MyfxbookConnection } from "@/types/database";

/**
 * Batch sync — the scheduler entry point. Works with ANY scheduler (Vercel
 * Cron, cron-job.org, GitHub Actions): authenticate with
 * `x-cron-secret: $CRON_SECRET` (or `?secret=` for schedulers that can't set
 * headers).
 *
 * Processes the most-stale due connections first, capped per invocation:
 * each connection costs ~2-4 Myfxbook calls at ≥1.2s spacing, so 6 keeps a
 * pass well inside maxDuration. Anything left over is picked up next tick —
 * with sync-on-visit and manual sync as additional triggers, no connection
 * depends solely on this route.
 */
export const maxDuration = 60;

const MAX_CONNECTIONS_PER_RUN = 6;
// Myfxbook free API tier ≈ 100 requests/day and their data only refreshes
// every few hours — schedule the external cron at 30-60 min, not minutes.
const STALE_MINUTES = 45;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 16) {
      return NextResponse.json(
        { error: "Batch sync is not configured (CRON_SECRET missing)." },
        { status: 503 },
      );
    }
    const provided =
      request.headers.get("x-cron-secret") ??
      request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("myfxbook_connections")
      .select("*")
      .is("revoked_at", null)
      .order("last_sync_at", { ascending: true, nullsFirst: true })
      .limit(25);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const due = ((data ?? []) as MyfxbookConnection[])
      .filter((c) => isSyncDue(c, STALE_MINUTES))
      .slice(0, MAX_CONNECTIONS_PER_RUN);

    const results: Array<{
      id: string;
      ok: boolean;
      processed?: number;
      error?: string;
    }> = [];

    // Sequential — Myfxbook rate-limits bursts; the client spaces calls.
    for (const connection of due) {
      const outcome = await syncMyfxbookConnection(admin, connection);
      results.push({
        id: connection.id,
        ok: outcome.ok,
        processed: outcome.result?.processed,
        error: outcome.error,
      });
    }

    return NextResponse.json({
      data: { synced: results.length, results },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
