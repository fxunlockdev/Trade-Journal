import type { Trade } from "@/types/database";

/**
 * A trade is "closed" for analytics purposes when `pnl_absolute` is set.
 * This is broader than "has exit_price" on purpose — multi-TP trades close
 * via `tp1_result = "hit"`/etc. and never get a manual `exit_price`, but
 * computeTradeFields fills in `pnl_absolute` from the TP results. The old
 * gate (exit_price !== null) silently treated those as open, so dashboard
 * stats came out as $0 / 0% / "0 closed trades" even with wins on screen.
 */
interface ClosedTrade {
  readonly pnl_absolute: number;
  readonly entry_time: string;
}

function getClosedTrades(trades: readonly Trade[]): readonly ClosedTrade[] {
  return trades.filter(
    (t): t is Trade & { pnl_absolute: number } =>
      t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute),
  );
}

export function computeTotalPnl(trades: readonly Trade[]): number {
  return getClosedTrades(trades).reduce((sum, t) => sum + t.pnl_absolute, 0);
}

export function computeWinRate(trades: readonly Trade[]): number {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return 0;
  const wins = closed.filter((t) => t.pnl_absolute > 0).length;
  return (wins / closed.length) * 100;
}

export function computeAvgWin(trades: readonly Trade[]): number {
  const wins = getClosedTrades(trades).filter((t) => t.pnl_absolute > 0);
  if (wins.length === 0) return 0;
  return wins.reduce((sum, t) => sum + t.pnl_absolute, 0) / wins.length;
}

export function computeAvgLoss(trades: readonly Trade[]): number {
  const losses = getClosedTrades(trades).filter((t) => t.pnl_absolute < 0);
  if (losses.length === 0) return 0;
  return losses.reduce((sum, t) => sum + t.pnl_absolute, 0) / losses.length;
}

/**
 * Expectancy — the average money a single trade is worth to you.
 *
 * `total P&L / number of closed trades`. Unlike win rate it can't be gamed by
 * many tiny wins funding one huge loss, which is exactly why it's the number
 * that tells you whether the system is worth trading at all.
 */
export function computeExpectancy(trades: readonly Trade[]): number | null {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return null;
  const total = closed.reduce((sum, t) => sum + t.pnl_absolute, 0);
  return total / closed.length;
}

export interface ExpectancyR {
  /** Average R across the closed trades that carry an R multiple. */
  readonly value: number;
  /** How many closed trades had an R multiple (i.e. had a stop loss). */
  readonly covered: number;
  /** How many closed trades there are in total. */
  readonly closed: number;
}

/**
 * Expectancy in R — the same idea normalised by risk, so it stays comparable
 * across position sizes and across journals with different capital.
 * `null` when no closed trade carries an R multiple.
 */
export function computeExpectancyR(
  trades: readonly Trade[],
): ExpectancyR | null {
  // Filtered off the raw trades: `r_multiple` lives on Trade, not on the
  // narrowed ClosedTrade shape. A closed trade still needs a finite P&L to
  // count, so both conditions are checked here.
  const withR = trades.filter(
    (t) =>
      t.pnl_absolute !== null &&
      Number.isFinite(t.pnl_absolute) &&
      t.r_multiple !== null &&
      Number.isFinite(t.r_multiple),
  );
  if (withR.length === 0) return null;
  return {
    value:
      withR.reduce((sum, t) => sum + (t.r_multiple as number), 0) / withR.length,
    // R only exists for trades that had a stop loss. Reporting an R average
    // taken over 1 of 10 trades next to a dollar average taken over all 10 is
    // how a losing system ends up advertising "+3.00R per trade", so the
    // coverage travels with the number and the caller qualifies it.
    covered: withR.length,
    closed: getClosedTrades(trades).length,
  };
}

/**
 * Payoff ratio — average win / average loss. Tells you how big your winners are
 * relative to your losers, which is what makes a sub-50% win rate survivable.
 * `null` when there are no losses yet (unbounded).
 */
export function computePayoffRatio(trades: readonly Trade[]): number | null {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return null;
  const avgWin = computeAvgWin(trades);
  const avgLoss = Math.abs(computeAvgLoss(trades));
  // No losses yet — the ratio is unbounded, which the caller renders as "∞".
  if (avgLoss === 0) return null;
  // Losses but no wins is a payoff ratio of ZERO, not "no data". Returning null
  // here would grey out the single most alarming reading on the card.
  return avgWin / avgLoss;
}

export function computeMaxDrawdown(trades: readonly Trade[]): number {
  const sorted = [...getClosedTrades(trades)].sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
  );

  if (sorted.length === 0) return 0;

  // Peak MUST track the running max of the equity curve, including negative
  // values. Initialising to 0 was wrong: for an account that starts with a
  // loss, peak stayed at 0 while cumPnl was negative, so the "drawdown"
  // reported the distance from 0 instead of from the actual peak.
  let peak = -Infinity;
  let cumPnl = 0;
  let maxDrawdown = 0;

  for (const trade of sorted) {
    cumPnl += trade.pnl_absolute;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

/**
 * Profit factor = gross profit / gross loss.
 *   - `null` when there is no data or no losses (unbounded / undefined).
 *   - A finite number otherwise.
 *
 * Returning `null` instead of `Infinity` prevents "Infinity" from leaking
 * into JSON serialisation, chart axes, and toFixed() calls. Callers render
 * `null` as "—" (no data) or "∞" (wins-only) based on their context.
 */
export function computeProfitFactor(
  trades: readonly Trade[],
): number | null {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return null;

  const grossProfit = closed
    .filter((t) => t.pnl_absolute > 0)
    .reduce((sum, t) => sum + t.pnl_absolute, 0);
  const grossLoss = Math.abs(
    closed
      .filter((t) => t.pnl_absolute < 0)
      .reduce((sum, t) => sum + t.pnl_absolute, 0),
  );
  if (grossLoss === 0) return null;
  return grossProfit / grossLoss;
}

export interface EquityCurvePoint {
  readonly date: string;
  readonly cumPnl: number;
}

export function computeEquityCurve(
  trades: readonly Trade[],
): readonly EquityCurvePoint[] {
  const sorted = [...getClosedTrades(trades)].sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
  );

  let cumPnl = 0;
  return sorted.map((trade) => {
    cumPnl += trade.pnl_absolute;
    return { date: trade.entry_time, cumPnl };
  });
}

export type Period = "day" | "week" | "month";

export interface PeriodStats {
  readonly period: string;
  readonly pnl: number;
  readonly tradeCount: number;
  readonly winRate: number;
}

export function groupTradesByPeriod(
  trades: readonly Trade[],
  period: Period,
): readonly PeriodStats[] {
  const closed = getClosedTrades(trades);

  const grouped = new Map<string, ClosedTrade[]>();

  for (const trade of closed) {
    const date = new Date(trade.entry_time);
    const key = getPeriodKey(date, period);
    const existing = grouped.get(key) ?? [];
    grouped.set(key, [...existing, trade]);
  }

  return Array.from(grouped.entries()).map(([key, periodTrades]) => {
    const pnl = periodTrades.reduce((sum, t) => sum + t.pnl_absolute, 0);
    const wins = periodTrades.filter((t) => t.pnl_absolute > 0).length;
    const winRate =
      periodTrades.length > 0 ? (wins / periodTrades.length) * 100 : 0;

    return {
      period: key,
      pnl,
      tradeCount: periodTrades.length,
      winRate,
    };
  });
}

/**
 * Period key — uses UTC accessors everywhere. Local TZ would bucket a
 * 01:30-UTC trade into the previous calendar day for any user west of UTC,
 * so charts disagreed with the trade's stored `entry_time` string.
 *
 * Week start: Monday (ISO-8601). This matches the Performance Calendar grid.
 */
function getPeriodKey(date: Date, period: Period): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  switch (period) {
    case "day":
      return `${year}-${month}-${day}`;
    case "week": {
      const utcDow = date.getUTCDay(); // 0=Sun, 1=Mon, …
      const isoOffset = utcDow === 0 ? 6 : utcDow - 1; // days since Monday
      const monday = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() - isoOffset,
        ),
      );
      const wYear = monday.getUTCFullYear();
      const wMonth = String(monday.getUTCMonth() + 1).padStart(2, "0");
      const wDay = String(monday.getUTCDate()).padStart(2, "0");
      return `${wYear}-${wMonth}-${wDay}`;
    }
    case "month":
      return `${year}-${month}`;
  }
}
