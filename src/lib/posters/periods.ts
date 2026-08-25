/**
 * Poster periods — the window a poster reports on.
 *
 * A period is a span of LOCAL CALENDAR DAYS in the viewer's timezone, because
 * that is what "today's results" means to the person posting. The rest of the
 * app buckets analytics by UTC day (`analytics.ts` getPeriodKey), so a poster
 * can legitimately differ from the calendar for a trade near midnight — the UI
 * states the timezone so that difference is visible rather than surprising.
 *
 * Ranges are expressed as inclusive first/last DAYS rather than a millisecond
 * interval, and membership is decided by comparing calendar dates. That is what
 * makes them immune to DST: in zones whose clocks shift at local midnight
 * (America/Santiago, America/Havana) a "day" is 23 or 25 hours long and local
 * 00:00 may not exist at all, so `setHours(0,0,0,0)` silently resolves forward
 * to 01:00 and every timestamp comparison built on it is displaced by an hour.
 * Comparing y/m/d never has that problem.
 */

export type PeriodId =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month";

export interface DateRange {
  /** First day INCLUDED, at local midnight. */
  readonly firstDay: Date;
  /** Last day INCLUDED, at local midnight. */
  readonly lastDay: Date;
}

export const PERIODS: readonly { readonly id: PeriodId; readonly label: string }[] =
  [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "this-week", label: "This Week" },
    { id: "last-week", label: "Last Week" },
    { id: "this-month", label: "This Month" },
    { id: "last-month", label: "Last Month" },
  ];

/**
 * Fixed month names rather than `toLocaleDateString`, which renders September
 * as "Sept" in en-GB — four characters where every other month is three. On a
 * typeset poster that makes the date line jump, and it would also shift with
 * the viewer's locale, so the same period could print differently for two
 * members of the same group.
 */
export const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * A sortable local-calendar-date key, e.g. 2026-08-25 -> 20260825. Comparing
 * these compares days without ever touching a timestamp.
 */
export function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Local midnight for a calendar date. `new Date(y, m, d)` normalises
 * out-of-range components (day 0 = last day of the previous month, month 12 =
 * January of the next year), which is what makes the calendar arithmetic below
 * safe across month and year boundaries.
 */
function localDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

export function resolvePeriod(period: PeriodId, now: Date = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (period) {
    case "today": {
      const day = localDay(y, m, d);
      return { firstDay: day, lastDay: day };
    }
    case "yesterday": {
      const day = localDay(y, m, d - 1);
      return { firstDay: day, lastDay: day };
    }
    case "this-week": {
      // Monday-start, matching the ISO week the rest of the app uses
      // (analytics.ts getPeriodKey treats Sunday as day 6, not day 0).
      const isoOffset = now.getDay() === 0 ? 6 : now.getDay() - 1;
      return {
        firstDay: localDay(y, m, d - isoOffset),
        lastDay: localDay(y, m, d - isoOffset + 6),
      };
    }
    case "last-week": {
      const isoOffset = now.getDay() === 0 ? 6 : now.getDay() - 1;
      return {
        firstDay: localDay(y, m, d - isoOffset - 7),
        lastDay: localDay(y, m, d - isoOffset - 1),
      };
    }
    case "this-month": {
      // Day 0 of the NEXT month is the last day of this one.
      return { firstDay: localDay(y, m, 1), lastDay: localDay(y, m + 1, 0) };
    }
    case "last-month": {
      return { firstDay: localDay(y, m - 1, 1), lastDay: localDay(y, m, 0) };
    }
  }
}

/** True when `date` falls on one of the calendar days in `range`. */
export function isInRange(date: Date, range: DateRange): boolean {
  const key = dayKey(date);
  return key >= dayKey(range.firstDay) && key <= dayKey(range.lastDay);
}

/** The label a poster prints for its period. */
export function periodKind(period: PeriodId): "DAILY" | "WEEKLY" | "MONTHLY" {
  if (period === "today" || period === "yesterday") return "DAILY";
  if (period === "this-week" || period === "last-week") return "WEEKLY";
  return "MONTHLY";
}

/**
 * Human date line, e.g. "25 Aug 2026" for a single day or "24 – 30 Aug 2026"
 * for a span. Both ends are days that are actually included, so the label can
 * never advertise a day whose trades aren't in the numbers.
 */
export function formatRangeLabel(range: DateRange): string {
  const { firstDay: a, lastDay: b } = range;
  const day = (x: Date) => x.getDate();
  const mon = (x: Date) => SHORT_MONTHS[x.getMonth()];
  const year = (x: Date) => x.getFullYear();

  if (dayKey(a) === dayKey(b)) return `${day(a)} ${mon(a)} ${year(a)}`;
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${day(a)} – ${day(b)} ${mon(b)} ${year(b)}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${year(b)}`;
  }
  return `${day(a)} ${mon(a)} ${year(a)} – ${day(b)} ${mon(b)} ${year(b)}`;
}

/** A whole calendar month prints as "August 2026" rather than a day span. */
export function formatPeriodLabel(period: PeriodId, range: DateRange): string {
  if (period === "this-month" || period === "last-month") {
    return `${LONG_MONTHS[range.firstDay.getMonth()]} ${range.firstDay.getFullYear()}`;
  }
  return formatRangeLabel(range);
}
