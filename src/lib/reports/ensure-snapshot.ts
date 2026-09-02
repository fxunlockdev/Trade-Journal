import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot } from "@/lib/reports/snapshot";
import {
  resolveReportPeriod,
  tradesInReportPeriod,
  type Cadence,
  type ReportPeriod,
} from "@/lib/reports/periods-tz";
import { computeReportMetrics } from "@/lib/reports/metrics";
import type { ReportDesk, Trade } from "@/types/database";

/**
 * Find or freeze the report for a desk's current period.
 *
 * The button, the scheduler and the Telegram commands all need this, and all
 * three must agree on what "yesterday's report for this desk" is. One
 * implementation, so they cannot drift.
 */

/** Widened past the period so a trade CLOSED inside it but entered earlier is
 *  still fetched. Exact membership is decided in the desk's own timezone. */
const EDGE_DAYS = 3;

/** A year back is generous cover for a monthly period plus long-held trades,
 *  while keeping the query bounded well under PostgREST's row ceiling. */
const LOOKBACK_DAYS = 365;

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export interface StoredSnapshot {
  readonly id: string;
  readonly cadence: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly metrics: unknown;
  readonly trade_count: number;
  readonly status: string;
}

export type EnsureResult =
  | { readonly kind: "ok"; readonly snapshot: StoredSnapshot; readonly reused: boolean }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string };

const COLUMNS =
  "id, cadence, period_start, period_end, metrics, trade_count, status";

/**
 * `admin` because `trades` is deny-all RLS by design. The caller is responsible
 * for having proved the requester may see this desk's journals.
 */
export async function ensureSnapshot(
  admin: SupabaseClient,
  desk: ReportDesk,
  cadence: Cadence,
  now: Date,
): Promise<EnsureResult> {
  const period = resolveReportPeriod(cadence, now, desk.timezone);

  // FROZEN MEANS FROZEN. An existing snapshot is returned untouched: its
  // numbers may already be printed on a poster in a partners' group, and
  // recomputing them would change what that poster means after the fact.
  const existing = await admin
    .from("report_snapshots")
    .select(COLUMNS)
    .eq("desk_id", desk.id)
    .eq("cadence", cadence)
    .eq("period_start", period.start)
    .eq("period_end", period.end)
    .maybeSingle();

  if (existing.error) {
    return { kind: "error", message: "Could not read that report." };
  }
  if (existing.data) {
    const snap = existing.data as unknown as StoredSnapshot;
    if (snap.trade_count === 0) return { kind: "empty" };
    return { kind: "ok", snapshot: snap, reused: true };
  }

  const { data: trades, error: tradesError } = await admin
    .from("trades")
    .select("*")
    .in("journal_id", desk.journal_ids)
    .gte("entry_time", shiftIso(period.start, -LOOKBACK_DAYS))
    .lte("entry_time", shiftIso(period.end, EDGE_DAYS));

  if (tradesError) {
    return { kind: "error", message: "Could not read trades for that desk." };
  }

  const draft = buildSnapshot(desk, cadence, (trades ?? []) as Trade[], now);

  // An empty period is not written and not published. A poster reading zero
  // trades tells a partner nothing and looks like a fault.
  if (draft.trade_count === 0) return { kind: "empty" };

  const inserted = await admin
    .from("report_snapshots")
    .insert(draft)
    .select(COLUMNS)
    .single();

  if (inserted.error) {
    // 23505: another caller created the same period between the read and the
    // insert. The unique index is the arbiter; read back what it kept rather
    // than racing it.
    if (inserted.error.code === "23505") {
      const raced = await admin
        .from("report_snapshots")
        .select(COLUMNS)
        .eq("desk_id", desk.id)
        .eq("cadence", cadence)
        .eq("period_start", period.start)
        .eq("period_end", period.end)
        .maybeSingle();
      if (raced.data) {
        return {
          kind: "ok",
          snapshot: raced.data as unknown as StoredSnapshot,
          reused: true,
        };
      }
    }
    return { kind: "error", message: "Could not save that report." };
  }

  return {
    kind: "ok",
    snapshot: inserted.data as unknown as StoredSnapshot,
    reused: false,
  };
}

/**
 * Recompute a snapshot's numbers from the trades as they stand NOW.
 *
 * The opposite of what `ensureSnapshot` does, and only ever called because
 * somebody asked. Freezing is right for everything automatic: a poster in a
 * partners' group must keep meaning what it meant when it was published, and
 * nothing unattended should quietly restate it.
 *
 * But trades get corrected and imported late, so a report can become wrong
 * after the fact, and refusing to ever refresh it means the wrong version is
 * the permanent one. This is the deliberate way out, reachable only from a
 * human action.
 */
export async function refreshSnapshot(
  admin: SupabaseClient,
  desk: ReportDesk,
  snapshot: StoredSnapshot,
): Promise<EnsureResult> {
  const { data: trades, error: tradesError } = await admin
    .from("trades")
    .select("*")
    .in("journal_id", desk.journal_ids)
    .gte("entry_time", shiftIso(snapshot.period_start, -LOOKBACK_DAYS))
    .lte("entry_time", shiftIso(snapshot.period_end, EDGE_DAYS));

  if (tradesError) {
    return { kind: "error", message: "Could not read trades for that desk." };
  }

  const period: ReportPeriod = {
    cadence: snapshot.cadence as Cadence,
    start: snapshot.period_start,
    end: snapshot.period_end,
  };
  const covered = tradesInReportPeriod(
    (trades ?? []).filter((t) =>
      desk.journal_ids.includes((t as Trade).journal_id),
    ) as Trade[],
    period,
    desk.timezone,
  );

  if (covered.length === 0) return { kind: "empty" };

  const metrics = computeReportMetrics(covered, desk.timezone);

  const { data: updated, error } = await admin
    .from("report_snapshots")
    .update({
      metrics,
      trade_count: covered.length,
      // Back to pending: the previous render is of numbers that no longer
      // apply, so it must not be treated as already drawn.
      status: "pending",
      error: null,
    })
    .eq("id", snapshot.id)
    .select(COLUMNS)
    .single();

  if (error || !updated) {
    return { kind: "error", message: "Could not refresh that report." };
  }

  return {
    kind: "ok",
    snapshot: updated as unknown as StoredSnapshot,
    reused: false,
  };
}
