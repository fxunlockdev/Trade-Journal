import type { Trade } from "@/types/database";

export interface InstrumentStat {
  readonly instrument: string;
  readonly trades: number;
  readonly wins: number;
  readonly win_rate: number;
  readonly pnl: number;
}

export interface DirectionStat {
  readonly trades: number;
  readonly wins: number;
  readonly win_rate: number;
  readonly pnl: number;
}

export interface HourStat {
  readonly hour: number;
  readonly trades: number;
  readonly win_rate: number;
  readonly pnl: number;
}

export interface DayStat {
  readonly day: string;
  readonly trades: number;
  readonly win_rate: number;
  readonly pnl: number;
}

export interface TradingStats {
  readonly total_trades: number;
  readonly closed_trades: number;
  readonly open_trades: number;
  readonly win_rate: number;
  readonly total_pnl: number;
  readonly avg_win: number;
  readonly avg_loss: number;
  readonly profit_factor: number;
  readonly avg_rr_ratio: number | null;
  readonly max_consecutive_losses: number;
  readonly pct_with_stop_loss: number;
  readonly pct_with_take_profit: number;
  readonly avg_hold_time_hours: number | null;
  readonly by_instrument: readonly InstrumentStat[];
  readonly by_direction: {
    readonly buy: DirectionStat;
    readonly sell: DirectionStat;
  };
  readonly worst_hour: HourStat | null;
  readonly best_hour: HourStat | null;
  readonly worst_day: DayStat | null;
  readonly best_day: DayStat | null;
  readonly max_consecutive_wins: number;
  readonly recent_losing_streak: number;
  readonly recent_trades_text: string;
}

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function safeAverage(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeConsecutiveRuns(
  closedByTime: readonly Trade[]
): { maxLosses: number; maxWins: number; recentLosingStreak: number } {
  if (closedByTime.length === 0) {
    return { maxLosses: 0, maxWins: 0, recentLosingStreak: 0 };
  }

  let maxLosses = 0;
  let maxWins = 0;
  let currentLosses = 0;
  let currentWins = 0;

  for (const trade of closedByTime) {
    const isWin = (trade.pnl_absolute ?? 0) > 0;
    if (isWin) {
      currentWins += 1;
      currentLosses = 0;
    } else {
      currentLosses += 1;
      currentWins = 0;
    }
    if (currentLosses > maxLosses) maxLosses = currentLosses;
    if (currentWins > maxWins) maxWins = currentWins;
  }

  // Recent losing streak: count backwards from the end
  let recentLosingStreak = 0;
  for (let i = closedByTime.length - 1; i >= 0; i--) {
    const isWin = (closedByTime[i].pnl_absolute ?? 0) > 0;
    if (!isWin) {
      recentLosingStreak += 1;
    } else {
      break;
    }
  }

  return { maxLosses, maxWins, recentLosingStreak };
}

function computeDirectionStat(
  trades: readonly Trade[],
  direction: "buy" | "sell"
): DirectionStat {
  const subset = trades.filter(
    (t) => t.direction === direction && t.exit_price !== null
  );
  const wins = subset.filter((t) => (t.pnl_absolute ?? 0) > 0);
  const totalPnl = subset.reduce((sum, t) => sum + (t.pnl_absolute ?? 0), 0);
  return {
    trades: subset.length,
    wins: wins.length,
    win_rate:
      subset.length > 0 ? (wins.length / subset.length) * 100 : 0,
    pnl: totalPnl,
  };
}

function computeByInstrument(
  closedTrades: readonly Trade[]
): readonly InstrumentStat[] {
  const map = new Map<
    string,
    { wins: number; count: number; pnl: number }
  >();

  for (const trade of closedTrades) {
    const existing = map.get(trade.instrument) ?? {
      wins: 0,
      count: 0,
      pnl: 0,
    };
    const isWin = (trade.pnl_absolute ?? 0) > 0;
    map.set(trade.instrument, {
      wins: existing.wins + (isWin ? 1 : 0),
      count: existing.count + 1,
      pnl: existing.pnl + (trade.pnl_absolute ?? 0),
    });
  }

  return Array.from(map.entries())
    .map(([instrument, { wins, count, pnl }]) => ({
      instrument,
      trades: count,
      wins,
      win_rate: count > 0 ? (wins / count) * 100 : 0,
      pnl,
    }))
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 8);
}

interface HourAccumulator {
  readonly wins: number;
  readonly count: number;
  readonly pnl: number;
}

function computeHourStats(
  closedTrades: readonly Trade[]
): { best: HourStat | null; worst: HourStat | null } {
  const map = new Map<number, HourAccumulator>();

  for (const trade of closedTrades) {
    const hour = new Date(trade.entry_time).getUTCHours();
    const existing: HourAccumulator = map.get(hour) ?? {
      wins: 0,
      count: 0,
      pnl: 0,
    };
    const isWin = (trade.pnl_absolute ?? 0) > 0;
    map.set(hour, {
      wins: existing.wins + (isWin ? 1 : 0),
      count: existing.count + 1,
      pnl: existing.pnl + (trade.pnl_absolute ?? 0),
    });
  }

  const qualified: HourStat[] = Array.from(map.entries())
    .filter(([, { count }]) => count >= 2)
    .map(([hour, { wins, count, pnl }]) => ({
      hour,
      trades: count,
      win_rate: (wins / count) * 100,
      pnl,
    }));

  if (qualified.length === 0) return { best: null, worst: null };

  const best = qualified.reduce((a, b) => (a.pnl >= b.pnl ? a : b));
  const worst = qualified.reduce((a, b) => (a.pnl <= b.pnl ? a : b));
  return { best, worst };
}

interface DayAccumulator {
  readonly wins: number;
  readonly count: number;
  readonly pnl: number;
}

function computeDayStats(
  closedTrades: readonly Trade[]
): { best: DayStat | null; worst: DayStat | null } {
  const map = new Map<string, DayAccumulator>();

  for (const trade of closedTrades) {
    const day = DAYS_OF_WEEK[new Date(trade.entry_time).getUTCDay()];
    const existing: DayAccumulator = map.get(day) ?? {
      wins: 0,
      count: 0,
      pnl: 0,
    };
    const isWin = (trade.pnl_absolute ?? 0) > 0;
    map.set(day, {
      wins: existing.wins + (isWin ? 1 : 0),
      count: existing.count + 1,
      pnl: existing.pnl + (trade.pnl_absolute ?? 0),
    });
  }

  const qualified: DayStat[] = Array.from(map.entries())
    .filter(([, { count }]) => count >= 2)
    .map(([day, { wins, count, pnl }]) => ({
      day,
      trades: count,
      win_rate: (wins / count) * 100,
      pnl,
    }));

  if (qualified.length === 0) return { best: null, worst: null };

  const best = qualified.reduce((a, b) => (a.pnl >= b.pnl ? a : b));
  const worst = qualified.reduce((a, b) => (a.pnl <= b.pnl ? a : b));
  return { best, worst };
}

function formatPnl(pnl: number | null): string {
  if (pnl === null) return "open";
  const abs = Math.abs(pnl).toFixed(0);
  return pnl >= 0 ? `+$${abs}` : `-$${abs}`;
}

function buildRecentTradesText(closedByTime: readonly Trade[]): string {
  const last10 = closedByTime.slice(-10);
  return last10
    .map((t) => {
      const pnlStr = formatPnl(t.pnl_absolute);
      const entryStr = t.entry_price.toString();
      const exitStr = t.exit_price !== null ? t.exit_price.toString() : "open";
      return `${t.instrument} ${t.direction.toUpperCase()} ${pnlStr} (entry ${entryStr}, exit ${exitStr})`;
    })
    .join(" | ");
}

export function computeTradingStats(
  trades: readonly Trade[]
): TradingStats {
  const closedTrades = trades.filter((t) => t.exit_price !== null);
  const openTrades = trades.filter((t) => t.exit_price === null);

  const wins = closedTrades.filter((t) => (t.pnl_absolute ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.pnl_absolute ?? 0) <= 0);

  const winRate =
    closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  const totalPnl = closedTrades.reduce(
    (sum, t) => sum + (t.pnl_absolute ?? 0),
    0
  );

  const avgWin =
    safeAverage(wins.map((t) => t.pnl_absolute ?? 0)) ?? 0;
  const avgLoss =
    Math.abs(safeAverage(losses.map((t) => t.pnl_absolute ?? 0)) ?? 0);

  const sumWins = wins.reduce((sum, t) => sum + (t.pnl_absolute ?? 0), 0);
  const sumLosses = Math.abs(
    losses.reduce((sum, t) => sum + (t.pnl_absolute ?? 0), 0)
  );
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : 0;

  const rrValues = trades
    .map((t) => t.risk_reward_ratio)
    .filter((v): v is number => v !== null);
  const avgRrRatio = safeAverage(rrValues);

  const closedByTime = [...closedTrades].sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  );

  const { maxLosses, maxWins, recentLosingStreak } =
    computeConsecutiveRuns(closedByTime);

  const pctWithStopLoss =
    trades.length > 0
      ? (trades.filter((t) => t.stop_loss !== null).length / trades.length) *
        100
      : 0;

  const pctWithTakeProfit =
    trades.length > 0
      ? (trades.filter((t) => t.take_profit !== null).length / trades.length) *
        100
      : 0;

  const holdTimes = closedTrades
    .filter((t) => t.exit_time !== null)
    .map((t) => {
      const entryMs = new Date(t.entry_time).getTime();
      const exitMs = new Date(t.exit_time as string).getTime();
      return (exitMs - entryMs) / (1000 * 60 * 60);
    });
  const avgHoldTimeHours = safeAverage(holdTimes);

  const byInstrument = computeByInstrument(closedTrades);

  const byDirection = {
    buy: computeDirectionStat(trades, "buy"),
    sell: computeDirectionStat(trades, "sell"),
  };

  const { best: bestHour, worst: worstHour } = computeHourStats(closedTrades);
  const { best: bestDay, worst: worstDay } = computeDayStats(closedTrades);

  const recentTradesText = buildRecentTradesText(closedByTime);

  return {
    total_trades: trades.length,
    closed_trades: closedTrades.length,
    open_trades: openTrades.length,
    win_rate: winRate,
    total_pnl: totalPnl,
    avg_win: avgWin,
    avg_loss: avgLoss,
    profit_factor: profitFactor,
    avg_rr_ratio: avgRrRatio,
    max_consecutive_losses: maxLosses,
    pct_with_stop_loss: pctWithStopLoss,
    pct_with_take_profit: pctWithTakeProfit,
    avg_hold_time_hours: avgHoldTimeHours,
    by_instrument: byInstrument,
    by_direction: byDirection,
    worst_hour: worstHour,
    best_hour: bestHour,
    worst_day: worstDay,
    best_day: bestDay,
    max_consecutive_wins: maxWins,
    recent_losing_streak: recentLosingStreak,
    recent_trades_text: recentTradesText,
  };
}
