import type { Trade } from "@/types/database";
import { resolveCloseDate } from "@/lib/posters/poster-data";

/**
 * Reporting periods in a DESK'S timezone, not the server's.
 *
 * `lib/posters/periods.ts` resolves periods in the process timezone, which is
 * right in a browser — "today" means the viewer's today. It is wrong for a
 * scheduled job: on Vercel the process runs in UTC, so a London desk asking for
 * "yesterday" at 06:00 BST would get a window an hour out, and every trade near
 * midnight would land in the wrong report.
 *
 * So the browser keeps its module and the scheduler gets this one. Both exist
 * on purpose; neither should be used in the other's place.
 *
 * Dates are handled as y/m/d TRIPLES derived through Intl, never by adding
 * milliseconds. A day is 23 or 25 hours long across a DST change, and in a few
 * zones local midnight does not exist at all, so arithmetic on timestamps
 * silently displaces the boundary. Comparing calendar dates cannot.
 */

export type Cadence = "daily" | "weekly" | "monthly";

export interface ZonedDate {
  readonly year: number;
  /** 1-12, unlike Date's 0-11. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  /** 0 = Sunday, matching Date.getDay(). */
  readonly weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** What the wall clock reads in `timeZone` at this instant. */
export function zonedNow(instant: Date, timeZone: string): ZonedDate {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Some locales render midnight as "24"; normalise so hour is 0-23.
    hour: Number(get("hour")) % 24,
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** ISO calendar date, the form `period_start` / `period_end` are stored in. */
export function isoDate(d: { year: number; month: number; day: number }): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

/**
 * Shift a calendar date by whole days.
 *
 * Done in UTC deliberately: this is pure calendar arithmetic on a y/m/d triple
 * with no timezone attached, and UTC is the only zone guaranteed to have every
 * midnight. Converting to local first is what makes DST bugs.
 */
function shiftDays(
  d: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const t = Date.UTC(d.year, d.month - 1, d.day) + days * 86_400_000;
  const x = new Date(t);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
  };
}

export interface ReportPeriod {
  readonly cadence: Cadence;
  /** Inclusive ISO date. */
  readonly start: string;
  /** Inclusive ISO date. */
  readonly end: string;
}

/**
 * The period a report covers when it runs at `instant` in `timeZone`.
 *
 *   daily    yesterday
 *   weekly   the Monday-to-Friday just gone
 *   monthly  the whole previous calendar month
 *
 * Always a period that has ENDED. A report is a closed claim about a finished
 * stretch of time, so nothing here can include today.
 */
export function resolveReportPeriod(
  cadence: Cadence,
  instant: Date,
  timeZone: string,
): ReportPeriod {
  const now = zonedNow(instant, timeZone);

  if (cadence === "daily") {
    const y = shiftDays(now, -1);
    return { cadence, start: isoDate(y), end: isoDate(y) };
  }

  if (cadence === "weekly") {
    // Back to the most recent Friday that has finished. On Saturday that is
    // yesterday; run on any other day it is still the last completed week,
    // which keeps a manual mid-week trigger meaningful.
    const daysSinceFriday = (now.weekday - 5 + 7) % 7;
    const friday = shiftDays(now, -(daysSinceFriday === 0 ? 7 : daysSinceFriday));
    const monday = shiftDays(friday, -4);
    return { cadence, start: isoDate(monday), end: isoDate(friday) };
  }

  // Monthly: the previous calendar month, whole.
  const firstOfThis = { year: now.year, month: now.month, day: 1 };
  const lastOfPrev = shiftDays(firstOfThis, -1);
  const firstOfPrev = { year: lastOfPrev.year, month: lastOfPrev.month, day: 1 };
  return { cadence, start: isoDate(firstOfPrev), end: isoDate(lastOfPrev) };
}

/**
 * Does this trade's close fall inside the period, in the desk's timezone?
 *
 * Uses the same `resolveCloseDate` the posters use — close time, falling back
 * to entry when none was recorded — so a report and a poster of the same window
 * contain the same trades.
 */
export function tradeInPeriod(
  trade: Trade,
  period: ReportPeriod,
  timeZone: string,
): boolean {
  const { date } = resolveCloseDate(trade);
  if (Number.isNaN(date.getTime())) return false;
  const key = isoDate(zonedNow(date, timeZone));
  return key >= period.start && key <= period.end;
}

/** The closed trades a report covers. */
export function tradesInReportPeriod(
  trades: readonly Trade[],
  period: ReportPeriod,
  timeZone: string,
): readonly Trade[] {
  return trades.filter(
    (t) =>
      t.pnl_absolute !== null &&
      Number.isFinite(t.pnl_absolute) &&
      tradeInPeriod(t, period, timeZone),
  );
}

/** e.g. "1 Sep 2026" or "25-29 Aug 2026" or "August 2026". */
export function formatPeriodLabel(period: ReportPeriod): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [sy, sm, sd] = period.start.split("-").map(Number);
  const [ey, em, ed] = period.end.split("-").map(Number);

  if (period.cadence === "daily") return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  if (period.cadence === "monthly") {
    const FULL = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return `${FULL[sm - 1]} ${sy}`;
  }
  if (sm === em && sy === ey) return `${sd}-${ed} ${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} - ${ed} ${MONTHS[em - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} ${sy} - ${ed} ${MONTHS[em - 1]} ${ey}`;
}
