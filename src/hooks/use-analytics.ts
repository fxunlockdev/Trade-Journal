"use client";

import { useState, useMemo } from "react";
import {
  computeTotalPnl,
  computeWinRate,
  computeAvgWin,
  computeAvgLoss,
  computeMaxDrawdown,
  computeProfitFactor,
  computeEquityCurve,
  groupTradesByPeriod,
  type Period,
  type EquityCurvePoint,
  type PeriodStats,
} from "@/lib/trades/analytics";
import type { Trade } from "@/types/database";

interface AnalyticsResult {
  readonly totalPnl: number;
  readonly winRate: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly equityCurve: readonly EquityCurvePoint[];
  readonly periodStats: readonly PeriodStats[];
  readonly period: Period;
  readonly setPeriod: (period: Period) => void;
}

export function useAnalytics(trades: readonly Trade[]): AnalyticsResult {
  const [period, setPeriod] = useState<Period>("day");

  const totalPnl = useMemo(() => computeTotalPnl(trades), [trades]);
  const winRate = useMemo(() => computeWinRate(trades), [trades]);
  const avgWin = useMemo(() => computeAvgWin(trades), [trades]);
  const avgLoss = useMemo(() => computeAvgLoss(trades), [trades]);
  const maxDrawdown = useMemo(() => computeMaxDrawdown(trades), [trades]);
  const profitFactor = useMemo(() => computeProfitFactor(trades), [trades]);
  const equityCurve = useMemo(() => computeEquityCurve(trades), [trades]);
  const periodStats = useMemo(
    () => groupTradesByPeriod(trades, period),
    [trades, period],
  );

  return {
    totalPnl,
    winRate,
    avgWin,
    avgLoss,
    maxDrawdown,
    profitFactor,
    equityCurve,
    periodStats,
    period,
    setPeriod,
  };
}
