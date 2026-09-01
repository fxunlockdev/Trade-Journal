import { zonedNow, type Cadence, type ZonedDate } from "@/lib/reports/periods-tz";

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
