import {
  zonedNow,
  resolveReportPeriod,
  type Cadence,
  type ZonedDate,
  type ReportPeriod,
} from "@/lib/reports/periods-tz";

/**
 * When a desk's reports are due, in the desk's OWN timezone.
 *
 * Vercel crons fire in UTC, so a fixed UTC trigger is an hour wrong for half
 * the year in any zone that observes daylight saving: 06:00 in London is 05:00
 * UTC in summer and 06:00 in winter. Rather than encode that drift, the cron
 * ticks often and this function answers "has the local trigger passed today?"
 * That is correct all year, in every zone, with no DST table.
 *
 * It also survives a missed tick. A single daily trigger that gets dropped
 * means no report and nobody notices until a partner asks; a window that stays
 * open for the rest of the day means the next tick picks it up.
 *
 * Running repeatedly is safe because publishing is idempotent: the snapshot is
 * unique per period and the delivery claim refuses a second send. This function
 * decides WHEN to look, never whether something has already been sent.
 */

export interface CadenceSchedule {
  readonly cadence: Cadence;
  /** Local hour, 24h, at or after which the report may go out. */
  readonly hour: number;
  /** Local weekday it runs on, 0 = Sunday. Undefined means any day. */
  readonly weekday?: number;
  /** Local day of month it runs on. Undefined means any day. */
  readonly dayOfMonth?: number;
}

/**
 * Monthly is deliberately three hours after the others.
 *
 * On the 1st, the monthly and the daily both come due. Sharing an hour would
 * put 24 images into the group as one wall of pictures; separating them makes
 * two readable moments and keeps a month-end run from colliding with the
 * morning's daily.
 */
export const SCHEDULE: readonly CadenceSchedule[] = [
  { cadence: "daily", hour: 6 },
  { cadence: "weekly", hour: 6, weekday: 6 }, // Saturday, covering Mon-Fri
  { cadence: "monthly", hour: 9, dayOfMonth: 1 },
];

/** Whether one cadence's local trigger has passed, given a local wall clock. */
export function isCadenceDue(
  schedule: CadenceSchedule,
  local: ZonedDate,
): boolean {
  if (local.hour < schedule.hour) return false;
  if (schedule.weekday !== undefined && local.weekday !== schedule.weekday) {
    return false;
  }
  if (schedule.dayOfMonth !== undefined && local.day !== schedule.dayOfMonth) {
    return false;
  }
  return true;
}

/**
 * Every cadence currently due for a desk in `timeZone`.
 *
 * Ordered as SCHEDULE is, so on the 1st the daily is considered before the
 * monthly and the group receives them in that order.
 */
export function dueCadences(
  instant: Date,
  timeZone: string,
): readonly Cadence[] {
  const local = zonedNow(instant, timeZone);
  return SCHEDULE.filter((s) => isCadenceDue(s, local)).map((s) => s.cadence);
}

/**
 * How far back each cadence looks for a report it never managed to publish.
 *
 * A period is only ever computed relative to NOW, so "yesterday's report" runs
 * once, the morning after. If that day's trades are imported later -- and they
 * routinely are, because journals are filled from broker PDFs in batches days
 * behind -- the run found an empty period, skipped it, and never came back.
 * The report was not late. It never happened.
 *
 * Daily is the one that breaks: it has a single chance. Weekly and monthly are
 * more forgiving because their window closes long after the trades inside it,
 * but they have the same shape of bug, so they get a smaller lookback too.
 *
 * Bounded on purpose. Unbounded backfill would, on first deploy, try to publish
 * every day a desk has ever traded.
 */
const BACKFILL_PERIODS: Record<Cadence, number> = {
  daily: 7,
  weekly: 2,
  monthly: 2,
};

/** Move an instant back by whole periods of the given cadence. */
function shiftInstant(cadence: Cadence, instant: Date, periods: number): Date {
  const d = new Date(instant.getTime());
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() - periods);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() - periods * 7);
  else d.setUTCMonth(d.getUTCMonth() - periods);
  return d;
}

/**
 * Every period this cadence should still consider, OLDEST FIRST.
 *
 * Ordering is the point. A desk five days behind should publish the 28th, then
 * the 29th, then the 30th, so a reader scrolls the group and sees days in the
 * order they happened. Newest-first would tell the story backwards.
 *
 * The caller publishes at most one of these per tick, so a backlog trickles out
 * over an hour or two rather than arriving as a wall of images.
 *
 * Deduped because shifting the instant by a day lands inside the same week or
 * month repeatedly, which would otherwise return the same period several times.
 */
export interface CandidatePeriod extends ReportPeriod {
  /** The instant that resolves to this period, so the snapshot builder can be
   *  pointed at a past day without duplicating the period arithmetic. */
  readonly instant: Date;
}

export function periodsToConsider(
  cadence: Cadence,
  instant: Date,
  timeZone: string,
): readonly CandidatePeriod[] {
  const out: CandidatePeriod[] = [];
  const seen = new Set<string>();

  for (let back = BACKFILL_PERIODS[cadence]; back >= 0; back -= 1) {
    const at = shiftInstant(cadence, instant, back);
    const period = resolveReportPeriod(cadence, at, timeZone);
    const key = `${period.start}:${period.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...period, instant: at });
  }

  return out;
}
