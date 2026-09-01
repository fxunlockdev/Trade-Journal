import type { ReportDesk, Trade } from "@/types/database";
import { computeReportMetrics, type ReportMetrics } from "@/lib/reports/metrics";
import {
  resolveReportPeriod,
  tradesInReportPeriod,
  type Cadence,
  type ReportPeriod,
} from "@/lib/reports/periods-tz";

/**
 * Building a report snapshot.
 *
 * Pure: no clock, no database, no I/O. `instant` is passed in so the same
 * inputs always produce the same snapshot, which is what makes the whole
 * scheduler testable without mocking time.
 */

export interface ReportSnapshotDraft {
  readonly desk_id: string;
  readonly owner_user_id: string;
  readonly cadence: Cadence;
  readonly period_start: string;
  readonly period_end: string;
  readonly timezone: string;
  readonly metrics: ReportMetrics;
  readonly trade_count: number;
  /**
   * `skipped` when the period had no closed trades.
   *
   * Publishing a poster reading "0 trades, 0% win rate" into a partner group
   * is worse than publishing nothing: it looks like a bad day rather than a
   * day off, and it arrives every weekend and bank holiday. The row is still
   * written so the scheduler's idempotency key is claimed and it does not
   * reconsider the same empty period 96 times a day.
   */
  readonly status: "pending" | "skipped";
}

/**
 * The trades a desk's report covers.
 *
 * A desk can name several journals — "Gold Intraday" is two — so this narrows
 * by the desk's OWN journal list rather than by anything the caller passes.
 * That list is stored, sorted and deduplicated by a database trigger, so it
 * cannot be widened at report time.
 */
export function tradesForDesk(
  desk: ReportDesk,
  trades: readonly Trade[],
  period: ReportPeriod,
): readonly Trade[] {
  const journals = new Set(desk.journal_ids);
  return tradesInReportPeriod(
    trades.filter((t) => journals.has(t.journal_id)),
    period,
    desk.timezone,
  );
}

/** Everything needed to write one snapshot row, computed once. */
export function buildSnapshot(
  desk: ReportDesk,
  cadence: Cadence,
  trades: readonly Trade[],
  instant: Date,
): ReportSnapshotDraft {
  const period = resolveReportPeriod(cadence, instant, desk.timezone);
  const covered = tradesForDesk(desk, trades, period);
  const metrics = computeReportMetrics(covered, desk.timezone);

  return {
    desk_id: desk.id,
    owner_user_id: desk.owner_user_id,
    cadence,
    period_start: period.start,
    period_end: period.end,
    timezone: desk.timezone,
    metrics,
    trade_count: covered.length,
    status: covered.length === 0 ? "skipped" : "pending",
  };
}

/**
 * The key that makes the scheduler idempotent.
 *
 * Mirrors the unique index on (desk_id, cadence, period_start, period_end).
 * Exported so the scheduler can reason about, and log, the same identity the
 * database enforces — rather than two hand-written notions of "the same report"
 * that only have to disagree once.
 */
export function snapshotKey(draft: ReportSnapshotDraft): string {
  return `${draft.desk_id}:${draft.cadence}:${draft.period_start}:${draft.period_end}`;
}
