import type { Journal, RiskBasis, Trade } from "@/types/database";

/**
 * Account balance — the journal's capital as a living number.
 *
 * The balance is DERIVED, never stored: `starting capital + every closed
 * trade's P&L`. One source of truth, so editing or deleting a trade can't leave
 * a stale balance behind, and there is nothing to migrate or backfill.
 *
 * A trade counts once it is CLOSED (a finite `pnl_absolute`), matching the
 * "closed" definition every other analytics surface uses.
 */

/** Realized P&L across the closed trades in a set. */
export function realizedPnl(trades: readonly Trade[]): number {
  let total = 0;
  for (const t of trades) {
    if (t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute)) {
      total += t.pnl_absolute;
    }
  }
  return total;
}

/**
 * Current balance, or null when the journal has no capital configured (in which
 * case there is no account to track and sizing stays manual).
 */
export function computeCurrentBalance(
  startingCapital: number | null | undefined,
  trades: readonly Trade[],
): number | null {
  if (
    startingCapital == null ||
    !Number.isFinite(startingCapital) ||
    startingCapital <= 0
  ) {
    return null;
  }
  return startingCapital + realizedPnl(trades);
}

/**
 * The balance a risk % should be taken from.
 *
 * `compounding` uses the live balance, so a grown account risks more per trade
 * and a drawn-down one risks less — the "accumulated interest" effect. `fixed`
 * pins it to the starting capital for constant sizing.
 *
 * Guards against a wiped account: a balance at or below zero would size nothing
 * (or negatively), so it falls back to the starting capital and the caller can
 * say so rather than silently producing 0 lots.
 */
export interface RiskBase {
  /** The balance to take risk % from, or null when no capital is configured. */
  readonly base: number | null;
  /**
   * True when compounding wanted the live balance but couldn't use it because
   * the account is at or below zero, so `base` fell back to the starting
   * capital. Callers MUST NOT present that fallback as the "current balance" —
   * it isn't — and should refuse to suggest a size instead.
   */
  readonly depleted: boolean;
}

export function riskBaseBalance(args: {
  readonly startingCapital: number | null | undefined;
  readonly currentBalance: number | null | undefined;
  readonly basis: RiskBasis;
}): RiskBase {
  const { startingCapital, currentBalance, basis } = args;
  if (
    startingCapital == null ||
    !Number.isFinite(startingCapital) ||
    startingCapital <= 0
  ) {
    return { base: null, depleted: false };
  }
  if (basis === "fixed") return { base: startingCapital, depleted: false };
  if (currentBalance == null || !Number.isFinite(currentBalance)) {
    // Balance simply unknown (not yet fetched) — size off the capital, which is
    // the best available figure, and don't cry wolf about a blown account.
    return { base: startingCapital, depleted: false };
  }
  if (currentBalance <= 0) {
    return { base: startingCapital, depleted: true };
  }
  return { base: currentBalance, depleted: false };
}

/** The risk % to apply: the trade's own override, else the journal default. */
export function effectiveRiskPercent(args: {
  readonly tradeRiskPercent?: number | null;
  readonly journalDefault?: number | null;
}): number {
  const own = args.tradeRiskPercent;
  if (own != null && Number.isFinite(own) && own > 0) return own;
  const fallback = args.journalDefault;
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }
  return 1; // last-resort default, matching the column default
}

export interface EquityPoint {
  readonly date: string;
  /** Cumulative realized P&L at this point. */
  readonly cumPnl: number;
  /** Account balance: starting capital + cumPnl. */
  readonly balance: number;
  /** Return on the starting capital, in percent. */
  readonly returnPercent: number;
  /** Cumulative R-multiple across closed trades so far. */
  readonly cumR: number;
}

/**
 * Equity timeline for a chart. Ordered by the trade's entry time to stay
 * consistent with the rest of the app's time-series (the calendar and P&L-by-
 * period bucket on entry day too).
 *
 * `startingCapital` of 0/null still produces a usable series: balance simply
 * equals cumulative P&L and `returnPercent` stays 0, which is what the old
 * cumulative-profit chart showed.
 */
export function computeEquityTimeline(
  trades: readonly Trade[],
  startingCapital: number | null | undefined,
): readonly EquityPoint[] {
  const start =
    startingCapital != null && Number.isFinite(startingCapital) && startingCapital > 0
      ? startingCapital
      : 0;

  const closed = trades
    .filter((t) => t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute))
    .sort(
      (a, b) =>
        new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
    );

  let cumPnl = 0;
  let cumR = 0;
  return closed.map((t) => {
    cumPnl += t.pnl_absolute as number;
    if (t.r_multiple != null && Number.isFinite(t.r_multiple)) {
      cumR += t.r_multiple;
    }
    return {
      date: t.entry_time,
      cumPnl,
      balance: start + cumPnl,
      returnPercent: start > 0 ? (cumPnl / start) * 100 : 0,
      cumR,
    };
  });
}

/**
 * Max drawdown as a percentage of the running peak BALANCE.
 *
 * A "$500 drawdown" means nothing on its own — it's a scratch on a $100k
 * account and near-fatal on a $2k one. Measuring against the peak balance at
 * the time of each trough is the industry-standard reading, and it's only
 * computable once the journal has a capital figure.
 *
 * Returns null when there is no capital or no closed trades.
 */
export function computeMaxDrawdownPercent(
  trades: readonly Trade[],
  startingCapital: number | null | undefined,
): number | null {
  const timeline = computeEquityTimeline(trades, startingCapital);
  if (
    timeline.length === 0 ||
    startingCapital == null ||
    !Number.isFinite(startingCapital) ||
    startingCapital <= 0
  ) {
    return null;
  }

  // The peak starts at the opening balance: a first trade that loses money is a
  // real drawdown from your capital, not a flat start. `peak` therefore starts
  // positive and only ever grows, so it can never reach zero and invert the
  // division below.
  let peak = startingCapital;
  let maxPercent = 0;
  for (const point of timeline) {
    if (point.balance > peak) peak = point.balance;
    const percent = ((peak - point.balance) / peak) * 100;
    if (percent > maxPercent) maxPercent = percent;
  }

  // An account driven below zero mathematically drew down more than 100% of its
  // peak. "Max Drawdown 150%" reads as a bug rather than a wipeout, so cap the
  // number and let the caller say the account was wiped.
  return Math.min(maxPercent, 100);
}

/** True when losses drove the account to or below zero — a full wipeout. */
export function isAccountWiped(
  trades: readonly Trade[],
  startingCapital: number | null | undefined,
): boolean {
  const balance = computeCurrentBalance(startingCapital, trades);
  return balance !== null && balance <= 0;
}

/** Sum of the starting capital across journals (for the Portfolio view). */
export function combinedStartingCapital(
  journals: readonly Pick<Journal, "initial_capital">[],
): number | null {
  let total = 0;
  let any = false;
  for (const j of journals) {
    if (
      j.initial_capital != null &&
      Number.isFinite(j.initial_capital) &&
      j.initial_capital > 0
    ) {
      total += j.initial_capital;
      any = true;
    }
  }
  return any ? total : null;
}
