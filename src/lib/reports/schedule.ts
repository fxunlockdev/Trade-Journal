import {
  zonedNow,
  isoDate,
  shiftDays,
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
 * It also survives a missed tick, but only briefly. The window is deliberately
 * NARROW: a report is published in the couple of hours after its trigger, or
 * not automatically at all.
 *
 * An earlier version kept the window open until midnight, so a dropped tick
 * could still recover late in the day. That sounded generous and was wrong: it
 * meant marketing images could land in front of partners at two in the
 * afternoon with nothing scheduled for then. "Daily at 06:00" has to mean
 * 06:00, or the schedule is not a schedule. Anything outside the window is a
 * deliberate act through the app, never something that happens on its own.
 *
 * Running repeatedly is safe because publishing is idempotent: the snapshot is
 * unique per period and the delivery claim refuses a second send. This function
 * decides WHEN to look, never whether something has already been sent.
 */

/**
 * How long after the trigger hour a report may still publish automatically.
 *
 * Long enough to absorb a dropped tick or a slow morning; short enough that
 * nothing arrives at an hour nobody scheduled. Past this the run waits for
 * tomorrow, which is the safe failure: a late report is a nuisance, an
 * unexpected one in a partner channel is not.
 */
export const PUBLISH_WINDOW_HOURS = 2;

export interface CadenceSchedule {
  readonly cadence: Cadence;
  /** Local hour, 24h, at which the report goes out. */
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

/** Whether the local clock is inside this cadence's publishing window. */
export function isCadenceDue(
  schedule: CadenceSchedule,
  local: ZonedDate,
): boolean {
  if (local.hour < schedule.hour) return false;
  // The closing edge. Without it "due" means "any time from 06:00 to
  // midnight", which is how posters reached a partner channel at 14:31.
  if (local.hour >= schedule.hour + PUBLISH_WINDOW_HOURS) return false;
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
  /**
   * When this setup started publishing to this chat. Periods that ENDED before
   * it are never published automatically.
   *
   * This is the difference between rescuing a missed day and dumping history.
   * A new setup has no delivery record for ANY past period, so without this
   * every day in the lookback reads as "never published" and the backfill
   * publishes the lot. That is not theoretical: three setups created within
   * forty minutes of each other put eleven albums into a partner channel,
   * going back to days before the setups existed.
   *
   * Publishing something older stays possible, deliberately, through the button
   * in the app. It is a choice someone makes, not something that happens to
   * them.
   */
  since?: Date,
): readonly CandidatePeriod[] {
  const out: CandidatePeriod[] = [];
  const seen = new Set<string>();

  // Compared as local dates, because a period is a local date range and
  // `since` is an instant. Comparing them directly would be an hour wrong at
  // the edges, in the wrong direction, twice a year.
  const floor = since ? isoDate(zonedNow(since, timeZone)) : null;

  for (let back = BACKFILL_PERIODS[cadence]; back >= 0; back -= 1) {
    const at = shiftInstant(cadence, instant, back);
    const period = resolveReportPeriod(cadence, at, timeZone);
    // A period that finished before this setup existed is not a missed report,
    // it is history.
    if (floor !== null && period.end < floor) continue;

    const key = `${period.start}:${period.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...period, instant: at });
  }

  return out;
}

/**
 * When this cadence next publishes, as a local wall clock.
 *
 * Exists so the app can say "tomorrow at 06:00" instead of leaving someone to
 * work it out from a cron expression. Every confusion this feature has caused
 * was a silence: nothing arrived, nothing said why, and the person asked
 * whether it was broken. A next-run time answers most of that before it is
 * asked.
 *
 * Returns the local components rather than a Date, because the answer people
 * want is "06:00 on the 3rd in Dubai", and converting that back through UTC
 * only invites the hour to move.
 */
export interface NextRun {
  readonly cadence: Cadence;
  /** ISO local date, e.g. "2026-09-03". */
  readonly date: string;
  readonly hour: number;
  /** True when the window is open right now, so it may publish at any moment. */
  readonly dueNow: boolean;
}

export function nextRunFor(
  cadence: Cadence,
  instant: Date,
  timeZone: string,
): NextRun {
  const schedule = SCHEDULE.find((s) => s.cadence === cadence)!;
  const local = zonedNow(instant, timeZone);

  if (isCadenceDue(schedule, local)) {
    return { cadence, date: isoDate(local), hour: schedule.hour, dueNow: true };
  }

  // Walk forward a day at a time. A loop is used rather than arithmetic
  // because "the next Saturday" and "the next 1st" are awkward to express
  // directly, and a bounded scan of 40 days covers every cadence including a
  // month boundary without a special case per cadence.
  for (let ahead = 0; ahead <= 40; ahead += 1) {
    const day = shiftDays(local, ahead);
    // Today only counts if its trigger has not already passed.
    if (ahead === 0 && local.hour >= schedule.hour) continue;
    if (schedule.weekday !== undefined) {
      // `shiftDays` returns a bare y/m/d triple, so the weekday is derived
      // here. Date.UTC on that triple is safe for the same reason shiftDays
      // uses UTC: it is calendar arithmetic with no zone attached.
      const weekday = new Date(
        Date.UTC(day.year, day.month - 1, day.day),
      ).getUTCDay();
      if (weekday !== schedule.weekday) continue;
    }
    if (schedule.dayOfMonth !== undefined && day.day !== schedule.dayOfMonth) continue;
    return { cadence, date: isoDate(day), hour: schedule.hour, dueNow: false };
  }

  // Unreachable for the three cadences defined above; returned rather than
  // thrown so a scheduling change can never take the page down with it.
  return { cadence, date: isoDate(local), hour: schedule.hour, dueNow: false };
}
