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
