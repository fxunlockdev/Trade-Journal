import type { Trade } from "@/types/database";

/**
 * Monthly P&L calendar model — pure, deterministic, UTC.
 *
 * Every date bucket uses UTC (via `entry_time.slice(0, 10)`), exactly like
 * `groupTradesByPeriod` and the Performance Calendar heatmap. Mixing local and
 * UTC would silently shift an evening trade into the wrong day for any user
 * west of UTC, so the whole app anchors P&L to the trade's UTC entry day.
 *
 * A trade counts toward a day only when it is CLOSED — i.e. `pnl_absolute` is a
 * finite number. This matches the analytics "closed trade" definition:
 * multi-TP trades realise P&L via tp_results without an `exit_price`, and open
 * trades carry no realised P&L to place on the grid.
 */

/** Aggregated realised performance for one calendar day. */
export interface DayStats {
  /** YYYY-MM-DD in UTC. */
  readonly iso: string;
  /** Net realised P&L across the day's closed trades. */
  readonly pnl: number;
  /** Count of closed trades that day. */
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  /** Wins / tradeCount, 0..100. */
  readonly winRate: number;
}

/** One rendered cell of the month grid (Mon-first, 7 per week). */
export interface CalendarCell {
  /** YYYY-MM-DD in UTC. */
  readonly iso: string;
  /** Day-of-month (1..31). */
  readonly day: number;
  /** True when the cell belongs to the displayed month (not spill-over). */
  readonly inMonth: boolean;
  readonly isToday: boolean;
  /** True when the cell's date is after today (no data can exist yet). */
  readonly isFuture: boolean;
  /** Null when the day has no closed trades. */
  readonly stats: DayStats | null;
}

/** A week row plus its in-month totals (for an optional weekly summary). */
export interface WeekRow {
  readonly cells: readonly CalendarCell[];
  readonly pnl: number;
  readonly tradeCount: number;
}

/** The complete view-model a month renders from. */
export interface MonthView {
  readonly year: number;
  /** 0-based month (0 = January), matching JS Date. */
  readonly month: number;
  /** Human label, e.g. "July 2026". */
  readonly label: string;
  readonly weeks: readonly WeekRow[];
  readonly monthPnl: number;
  readonly tradingDays: number;
  readonly greenDays: number;
  readonly redDays: number;
  readonly totalTrades: number;
  /** Month win rate across closed trades, 0..100. */
  readonly winRate: number;
}

const MS_PER_DAY = 86_400_000;

/** UTC YYYY-MM-DD for a Date. */
function toUtcIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days since Monday for a UTC date (Mon=0 … Sun=6). */
function isoWeekdayOffset(date: Date): number {
  const dow = date.getUTCDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
}

/**
 * Bucket every closed trade into a UTC-day → DayStats map. Non-finite
 * `pnl_absolute` (null / NaN / Infinity) is skipped so it can never poison a
 * day's totals.
 */
export function buildDayStatsMap(
  trades: readonly Trade[],
): ReadonlyMap<string, DayStats> {
  const acc = new Map<
    string,
    { pnl: number; tradeCount: number; wins: number; losses: number }
  >();

  for (const trade of trades) {
    if (trade.pnl_absolute === null || !Number.isFinite(trade.pnl_absolute)) {
      continue;
    }
    const iso = trade.entry_time.slice(0, 10);
    const cur = acc.get(iso) ?? { pnl: 0, tradeCount: 0, wins: 0, losses: 0 };
    acc.set(iso, {
      pnl: cur.pnl + trade.pnl_absolute,
      tradeCount: cur.tradeCount + 1,
      wins: cur.wins + (trade.pnl_absolute > 0 ? 1 : 0),
      losses: cur.losses + (trade.pnl_absolute < 0 ? 1 : 0),
    });
  }

  const out = new Map<string, DayStats>();
  for (const [iso, v] of acc) {
    out.set(iso, {
      iso,
      pnl: v.pnl,
      tradeCount: v.tradeCount,
      wins: v.wins,
      losses: v.losses,
      winRate: v.tradeCount > 0 ? (v.wins / v.tradeCount) * 100 : 0,
    });
  }
  return out;
}

/**
 * Build the 7-column, Mon-first grid of UTC dates covering `month`, including
 * the spill-over days from the adjacent months that complete the first and
 * last weeks. Returns whole weeks (5 or 6 rows).
 */
function buildDateGrid(year: number, month: number): Date[][] {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(
    firstOfMonth.getTime() - isoWeekdayOffset(firstOfMonth) * MS_PER_DAY,
  );

  // Last day of the month, then extend to the end of its week (Sunday).
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
  const gridEnd = new Date(
    lastOfMonth.getTime() + (6 - isoWeekdayOffset(lastOfMonth)) * MS_PER_DAY,
  );

  const weeks: Date[][] = [];
  let cursor = gridStart.getTime();
  while (cursor <= gridEnd.getTime()) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(new Date(cursor));
      cursor += MS_PER_DAY;
    }
    weeks.push(week);
  }
  return weeks;
}

/** "July 2026" for a 0-based month, formatted in UTC. */
export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Step `delta` months from (year, month), normalising the rollover. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const base = new Date(Date.UTC(year, month + delta, 1));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() };
}

/**
 * Assemble the full month view-model. `today` is injected (defaults to now) so
 * the grid's today/future flags stay deterministic under test.
 */
export function buildMonthView(
  trades: readonly Trade[],
  year: number,
  month: number,
  today: Date = new Date(),
): MonthView {
  const dayStats = buildDayStatsMap(trades);
  const todayIso = toUtcIso(today);
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  const weeks: WeekRow[] = buildDateGrid(year, month).map((week) => {
    const cells: CalendarCell[] = week.map((date) => {
      const iso = toUtcIso(date);
      const inMonth = date.getUTCMonth() === month && date.getUTCFullYear() === year;
      return {
        iso,
        day: date.getUTCDate(),
        inMonth,
        isToday: iso === todayIso,
        isFuture: date.getTime() > todayUtcMs,
        stats: dayStats.get(iso) ?? null,
      };
    });
    const inMonthStats = cells
      .filter((c) => c.inMonth && c.stats)
      .map((c) => c.stats as DayStats);
    return {
      cells,
      pnl: inMonthStats.reduce((s, d) => s + d.pnl, 0),
      tradeCount: inMonthStats.reduce((s, d) => s + d.tradeCount, 0),
    };
  });

  // Month-level rollups over in-month trading days only.
  const monthDays = weeks
    .flatMap((w) => w.cells)
    .filter((c) => c.inMonth && c.stats)
    .map((c) => c.stats as DayStats);

  const totalTrades = monthDays.reduce((s, d) => s + d.tradeCount, 0);
  const totalWins = monthDays.reduce((s, d) => s + d.wins, 0);

  return {
    year,
    month,
    label: monthLabel(year, month),
    weeks,
    monthPnl: monthDays.reduce((s, d) => s + d.pnl, 0),
    tradingDays: monthDays.length,
    greenDays: monthDays.filter((d) => d.pnl > 0).length,
    redDays: monthDays.filter((d) => d.pnl < 0).length,
    totalTrades,
    winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
  };
}

/**
 * The (year, month) to open on: the month of the most recent trade, else the
 * month of `today`. Keeps the calendar from opening on an empty current month
 * when the user's latest activity was earlier.
 */
export function initialMonth(
  trades: readonly Trade[],
  today: Date = new Date(),
): { year: number; month: number } {
  let latest = "";
  for (const t of trades) {
    if (t.pnl_absolute === null || !Number.isFinite(t.pnl_absolute)) continue;
    const iso = t.entry_time.slice(0, 10);
    if (iso > latest) latest = iso;
  }
  if (latest) {
    const [y, m] = latest.split("-");
    return { year: Number(y), month: Number(m) - 1 };
  }
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() };
}
