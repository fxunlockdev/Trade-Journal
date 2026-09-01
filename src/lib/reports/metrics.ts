import type { Trade } from "@/types/database";
import {
  computePosterStats,
  resolveCloseDate,
  type PosterStats,
} from "@/lib/posters/poster-data";

/**
 * Everything a scheduled report can state.
 *
 * `PosterStats` is deliberately money-free — "No P&L, no account size, no
 * return %. That is both the design brief and the safe thing to publish." That
 * invariant stays: this COMPOSES it rather than extending it, so the existing
 * posters and their 470 lines of tests are untouched, and money is additive.
 *
 * Two rules run through the whole module, because a report is a public claim:
 *
 *   A figure that cannot be derived honestly is NULL, never zero. Printing
 *   "0.0R" or "£0 profit factor" asserts a measurement that was never taken.
 *
 *   Every figure comes from the SAME bucketing. `buildDayStatsMap` in
 *   calendar.ts buckets by UTC entry date; posters bucket by local close date
 *   via resolveCloseDate. Reusing the calendar's rollup would produce a report
 *   whose "12 trades" and "4 trading days" disagreed about which trades those
 *   were, so the day rollup below is computed the poster's way.
 */

export interface ReportMetrics {
  /** The pips-and-counts core, identical to what the posters already print. */
  readonly stats: PosterStats;

  /* ── money ──
   * All null when the period's trades are not a single currency: summing
   * euros into dollars silently is the one failure a published number must
   * never have. `currency` says which, or null when it could not be agreed. */
  readonly currency: string | null;
  readonly mixedCurrency: boolean;
  readonly netPnl: number | null;
  readonly grossProfit: number | null;
  /** Negative, so grossProfit + grossLoss === netPnl. */
  readonly grossLoss: number | null;
  readonly avgWin: number | null;
  /** Negative. */
  readonly avgLoss: number | null;
  readonly bestTrade: number | null;
  readonly worstTrade: number | null;
  /** Gross profit / |gross loss|. Null with no losses: it would be infinite. */
  readonly profitFactor: number | null;

  /* ── R ── */
  /** Sum of realised R across trades carrying one. Null when none do. */
  readonly netR: number | null;

  /* ── days, by local close date ── */
  readonly tradingDays: number;
  readonly profitableDays: number;
  readonly losingDays: number;
}

/** Closed, and carrying a usable P&L figure. */
function isClosed(t: Trade): boolean {
  return t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute);
}

/**
 * The one currency these trades are in, or null if they disagree.
 *
 * A NULL `pnl_currency` means "written before that column existed" — the
 * migration's own wording — so it is treated as unknown rather than as a
 * disagreement. A period of entirely pre-migration rows therefore still reports
 * money, labelled with no currency, which is what those figures have always
 * silently been.
 */
export function resolveCurrency(trades: readonly Trade[]): {
  readonly currency: string | null;
  readonly mixed: boolean;
} {
  const seen = new Set<string>();
  for (const t of trades) {
    const c = (t as { pnl_currency?: string | null }).pnl_currency;
    if (c) seen.add(c);
  }
  if (seen.size > 1) return { currency: null, mixed: true };
  return { currency: seen.size === 1 ? [...seen][0] : null, mixed: false };
}

/** Local calendar day key, matching how the posters bucket a trade. */
function closeDayKey(t: Trade): string {
  const { date } = resolveCloseDate(t);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

interface DayRollup {
  readonly tradingDays: number;
  readonly profitableDays: number;
  readonly losingDays: number;
}

/**
 * Days that traded, and how they finished.
 *
 * A day is profitable or losing on its NET P&L, not on its trade count: three
 * wins and one larger loss is a losing day, and saying otherwise would flatter
 * the record. A day that nets exactly zero counts as traded but as neither.
 */
export function rollupDays(trades: readonly Trade[]): DayRollup {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (!isClosed(t)) continue;
    const key = closeDayKey(t);
    byDay.set(key, (byDay.get(key) ?? 0) + (t.pnl_absolute as number));
  }
  let profitableDays = 0;
  let losingDays = 0;
  for (const net of byDay.values()) {
    if (net > 0) profitableDays++;
    else if (net < 0) losingDays++;
  }
  return { tradingDays: byDay.size, profitableDays, losingDays };
}

/**
 * Compute everything a report can state, from trades already narrowed to the
 * period. Pure: same inputs always produce the same report.
 */
export function computeReportMetrics(
  tradesInPeriod: readonly Trade[],
  timeZone: string,
): ReportMetrics {
  const closed = tradesInPeriod.filter(isClosed);
  const stats = computePosterStats(closed, timeZone);
  const { currency, mixed } = resolveCurrency(closed);
  const days = rollupDays(closed);

  // Money is withheld entirely rather than summed across currencies. A wrong
  // total is worse than an absent one on something being published.
  if (mixed || closed.length === 0) {
    return {
      stats,
      currency,
      mixedCurrency: mixed,
      netPnl: null,
      grossProfit: null,
      grossLoss: null,
      avgWin: null,
      avgLoss: null,
      bestTrade: null,
      worstTrade: null,
      profitFactor: null,
      netR: computeNetR(closed),
      ...days,
    };
  }

  const pnls = closed.map((t) => t.pnl_absolute as number);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);

  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + b, 0);

  return {
    stats,
    currency,
    mixedCurrency: false,
    netPnl: grossProfit + grossLoss,
    grossProfit,
    grossLoss,
    avgWin: wins.length > 0 ? grossProfit / wins.length : null,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : null,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
    // Null rather than Infinity when nothing lost: a period with no losses has
    // no ratio to report, and "∞" on a marketing image invites the wrong read.
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
    netR: computeNetR(closed),
    ...days,
  };
}

/**
 * Total realised R.
 *
 * Only trades that had a stop loss carry an r_multiple, so this is a sum over a
 * subset. `PosterStats.rCovered` already reports how large that subset is, and
 * the poster discloses it — the same qualification applies here.
 */
function computeNetR(trades: readonly Trade[]): number | null {
  let sum = 0;
  let covered = 0;
  for (const t of trades) {
    if (t.r_multiple !== null && Number.isFinite(t.r_multiple)) {
      sum += t.r_multiple;
      covered++;
    }
  }
  return covered === 0 ? null : sum;
}
