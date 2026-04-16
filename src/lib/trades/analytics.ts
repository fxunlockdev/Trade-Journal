import type { Trade } from "@/types/database";

interface ClosedTrade {
  readonly pnl_absolute: number;
  readonly entry_time: string;
  readonly exit_price: number;
}

function getClosedTrades(trades: readonly Trade[]): readonly ClosedTrade[] {
  return trades.filter(
    (t): t is Trade & { pnl_absolute: number; exit_price: number } =>
      t.exit_price !== null && t.pnl_absolute !== null,
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

  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;

  for (const trade of sorted) {
    cumPnl += trade.pnl_absolute;
    if (cumPnl > peak) {
      peak = cumPnl;
    }
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

export function computeProfitFactor(trades: readonly Trade[]): number {
  const closed = getClosedTrades(trades);
  const grossProfit = closed
    .filter((t) => t.pnl_absolute > 0)
    .reduce((sum, t) => sum + t.pnl_absolute, 0);
  const grossLoss = Math.abs(
    closed
      .filter((t) => t.pnl_absolute < 0)
      .reduce((sum, t) => sum + t.pnl_absolute, 0),
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
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

function getPeriodKey(date: Date, period: Period): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  switch (period) {
    case "day":
      return `${year}-${month}-${day}`;
    case "week": {
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      const wYear = startOfWeek.getFullYear();
      const wMonth = String(startOfWeek.getMonth() + 1).padStart(2, "0");
      const wDay = String(startOfWeek.getDate()).padStart(2, "0");
      return `${wYear}-${wMonth}-${wDay}`;
    }
    case "month":
      return `${year}-${month}`;
  }
}
