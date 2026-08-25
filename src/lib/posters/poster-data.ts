import { computeTotalPips, computeTradePips } from "@/lib/trades/pips";
import type { Trade } from "@/types/database";
import { isInRange, SHORT_MONTHS, type DateRange } from "@/lib/posters/periods";

/**
 * Poster statistics.
 *
 * A poster is a PUBLIC claim about performance, so every number here is
 * recomputed from real trades at generate time — nothing is cached, estimated,
 * or user-typed. Where a figure can't be derived honestly it is null and the
 * template omits it rather than printing a plausible-looking zero.
 *
 * Deliberately money-free: pips only. No P&L, no account size, no return %.
 * That is both the design brief and the safe thing to publish.
 */

/** A trade counts once it is CLOSED — the canonical predicate from analytics.ts. */
function isClosed(t: Trade): boolean {
  return t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute);
}

export type TradeResult = "win" | "loss" | "breakeven";

/**
 * Result from MONEY, not from TP flags.
 *
 * `deriveStatus` in trade-table.tsx prioritises tp*_result over P&L and can
 * label a net-negative trade a "win" (TP1 hit, TP2 stopped, fees eat the rest).
 * A poster's win count must reconcile with its own pips and with the dashboard,
 * so it reads the same signal every money metric reads.
 */
export function tradeResult(t: Trade): TradeResult {
  const pnl = t.pnl_absolute as number;
  if (pnl > 0) return "win";
  if (pnl < 0) return "loss";
  return "breakeven";
}

/**
 * The moment a trade counts towards a period.
 *
 * Prefers the real close time, because "daily results" means what you banked
 * that day. `exit_time` is only reliably set by the MT5 close path and the
 * manual form's optional field — multi-TP trades that close via tp*_result
 * historically never recorded one — so it falls back to entry time rather than
 * dropping the trade. `fromExit` travels with the value so the UI can disclose
 * how much of a poster rests on that fallback.
 */
export function resolveCloseDate(t: Trade): {
  readonly date: Date;
  readonly fromExit: boolean;
} {
  if (t.exit_time) {
    const exit = new Date(t.exit_time);
    if (!Number.isNaN(exit.getTime())) return { date: exit, fromExit: true };
  }
  return { date: new Date(t.entry_time), fromExit: false };
}

/** Closed trades whose resolved close date falls on a day within `range`. */
export function tradesInRange(
  trades: readonly Trade[],
  range: DateRange,
): readonly Trade[] {
  return trades.filter((t) => {
    if (!isClosed(t)) return false;
    const { date } = resolveCloseDate(t);
    if (Number.isNaN(date.getTime())) return false;
    return isInRange(date, range);
  });
}

export interface PosterTradeRow {
  readonly id: string;
  readonly date: string;
  readonly pair: string;
  readonly direction: "buy" | "sell";
  readonly entry: string;
  readonly pips: number | null;
  readonly result: TradeResult;
}

export interface PosterStats {
  readonly pips: number;
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakeven: number;
  /** Wins / (wins + losses) as a percent. Breakevens excluded — see below. */
  readonly winRate: number;
  /** Mean REALIZED R across trades that carry one. Null when none do. */
  readonly avgR: number | null;
  /** How many trades carried an r_multiple (i.e. had a stop loss). */
  readonly rCovered: number;
  /** Single instrument when the range is one pair, else "ALL PAIRS". */
  readonly asset: string;
  readonly log: readonly PosterTradeRow[];
  /** Trades bucketed by a REAL close time (the rest fell back to entry). */
  readonly closeTimeKnown: number;
  readonly timeZone: string;
}

/** Price formatting for the log: enough decimals to be recognisable per pair. */
function formatEntry(price: number, instrument: string): string {
  const symbol = instrument.toUpperCase();
  if (symbol.endsWith("JPY")) return price.toFixed(3);
  if (/^(XAU|XAG|BTC|ETH)/.test(symbol)) return price.toFixed(2);
  return price.toFixed(5);
}

/** Fixed month names, so a log row can't shift width or wording by locale. */
function shortDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${SHORT_MONTHS[d.getMonth()]}`;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Compute everything a template can print, from the trades already narrowed to
 * the period. Pure: same inputs always produce the same poster.
 */
export function computePosterStats(
  tradesInPeriod: readonly Trade[],
  timeZone: string = localTimeZone(),
): PosterStats {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let closeTimeKnown = 0;
  let rSum = 0;
  let rCovered = 0;

  const log: PosterTradeRow[] = [];
  const instruments = new Set<string>();

  // Ordered by resolved close date so a printed trade log reads chronologically
  // and matches the order the pips accumulated in.
  const ordered = [...tradesInPeriod].sort(
    (a, b) =>
      resolveCloseDate(a).date.getTime() - resolveCloseDate(b).date.getTime(),
  );

  for (const t of ordered) {
    const result = tradeResult(t);
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else breakeven++;

    const { date, fromExit } = resolveCloseDate(t);
    if (fromExit) closeTimeKnown++;

    // r_multiple exists only when the trade had a stop loss, so the average is
    // reported with its coverage rather than silently averaging a subset.
    if (t.r_multiple !== null && Number.isFinite(t.r_multiple)) {
      rSum += t.r_multiple;
      rCovered++;
    }

    instruments.add(t.instrument.toUpperCase());
    log.push({
      id: t.id,
      date: shortDate(date),
      pair: t.instrument.toUpperCase(),
      direction: t.direction,
      entry: formatEntry(t.entry_price, t.instrument),
      pips: computeTradePips(t),
      result,
    });
  }

  // Breakevens are excluded from the denominator: a trade taken off at entry is
  // neither a win nor a loss, and counting it as a loss (which dividing by all
  // closed trades does) understates a disciplined trader's win rate.
  const decided = wins + losses;

  return {
    pips: computeTotalPips(ordered),
    tradeCount: ordered.length,
    wins,
    losses,
    breakeven,
    winRate: decided === 0 ? 0 : (wins / decided) * 100,
    avgR: rCovered === 0 ? null : rSum / rCovered,
    rCovered,
    asset:
      instruments.size === 1
        ? [...instruments][0]
        : instruments.size === 0
          ? "—"
          : "ALL PAIRS",
    log,
    closeTimeKnown,
    timeZone,
  };
}

export interface LogWindow {
  /** The rows a template should print, in chronological order. */
  readonly visible: readonly PosterTradeRow[];
  /** How many rows were left out. */
  readonly hiddenCount: number;
  /** Net pips carried by the rows left out. */
  readonly hiddenPips: number;
}

/**
 * The slice of the trade log a fixed-size poster can actually print.
 *
 * Two decisions worth stating, because both are visible on the artefact:
 *
 * 1. It keeps the MOST RECENT rows. The log is chronological, so a naive
 *    `slice(0, n)` on a busy week prints Monday to Thursday and silently drops
 *    the weekend — the opposite of what "this week's results" should lead with.
 *
 * 2. It returns the pips carried by the dropped rows, so the template can say
 *    so. Without that, a reader adding up a truncated column lands well short
 *    of the headline and the poster looks like it is inflating its own total.
 */
export function windowTradeLog(
  log: readonly PosterTradeRow[],
  limit: number,
): LogWindow {
  if (limit <= 0 || log.length <= limit) {
    return { visible: log, hiddenCount: 0, hiddenPips: 0 };
  }
  const cut = log.length - limit;
  const hidden = log.slice(0, cut);
  let hiddenPips = 0;
  for (const row of hidden) {
    // Rows with no computable pips are skipped, matching computeTotalPips.
    if (row.pips !== null && Number.isFinite(row.pips)) hiddenPips += row.pips;
  }
  return { visible: log.slice(cut), hiddenCount: cut, hiddenPips };
}

/**
 * The headline pip total: always signed, whole pips.
 *
 * Rounded ONCE from the true sum, never from already-rounded rows — summing
 * rounded values drifts by up to half a pip per trade, which over a 20-trade
 * month is a visibly wrong headline.
 */
export function formatPips(pips: number): string {
  const rounded = Math.round(pips);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/**
 * A single trade's pips in the log, to one decimal.
 *
 * Design C prints the headline total AND every addend on the same image, so a
 * reader can add the column up. Whole-pip rows would not reconcile: twenty
 * trades of 10.49 pips each show as "+10" but total "+210". One decimal keeps
 * the column's sum within a pip of the headline, which is as close as a rounded
 * display can honestly get.
 */
export function formatRowPips(pips: number): string {
  const rounded = Math.round(pips * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

export function formatWinRate(winRate: number): string {
  return `${Math.round(winRate)}%`;
}

export function formatAvgR(avgR: number | null): string {
  if (avgR === null) return "—";
  return `${avgR >= 0 ? "" : "-"}${Math.abs(avgR).toFixed(1)}R`;
}
