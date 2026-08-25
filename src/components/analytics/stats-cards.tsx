"use client";

import {
  DollarSign,
  Percent,
  Scale,
  Target,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  computeExpectancy,
  computeExpectancyR,
  computeMaxDrawdown,
  computePayoffRatio,
  computeProfitFactor,
  computeTotalPnl,
  computeWinRate,
} from "@/lib/trades/analytics";
import { computeMaxDrawdownPercent, isAccountWiped } from "@/lib/trades/balance";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface StatsCardsProps {
  readonly trades: readonly Trade[];
  /**
   * Journal starting capital. When set, the money metrics gain an account-
   * relative reading (return on capital, drawdown as a % of peak balance) —
   * a $500 drawdown means nothing until you know the account size.
   */
  readonly startingCapital?: number | null;
}

interface StatCardData {
  readonly label: string;
  readonly value: string;
  readonly subtitle: string;
  readonly icon: React.ElementType;
  readonly colorClass: string;
  readonly bgGradient: string;
  readonly iconBg: string;
}

function buildCards(
  trades: readonly Trade[],
  startingCapital?: number | null,
): readonly StatCardData[] {
  const totalPnl = computeTotalPnl(trades);
  const winRate = computeWinRate(trades);
  const profitFactor = computeProfitFactor(trades);
  const maxDrawdown = computeMaxDrawdown(trades);
  const expectancy = computeExpectancy(trades);
  const expectancyR = computeExpectancyR(trades);
  const payoff = computePayoffRatio(trades);
  const hasCapital =
    startingCapital != null &&
    Number.isFinite(startingCapital) &&
    startingCapital > 0;
  const drawdownPercent = computeMaxDrawdownPercent(trades, startingCapital);
  const returnOnAccount = hasCapital ? (totalPnl / startingCapital) * 100 : null;
  const wiped = isAccountWiped(trades, startingCapital);

  // "Closed" just needs a computed pnl_absolute — multi-TP trades have it
  // set from tp_results and never have an exit_price, but they ARE closed.
  const closedCount = trades.filter(
    (t) => t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute),
  ).length;
  const winCount = trades.filter(
    (t) => t.pnl_absolute !== null && t.pnl_absolute > 0,
  ).length;
  const lossCount = trades.filter(
    (t) => t.pnl_absolute !== null && t.pnl_absolute < 0,
  ).length;
  // Profit factor is null for BOTH "no data" and "wins with zero losses"
  // (mathematically infinite). Distinguish them so a flawless run doesn't read
  // as "Not enough data".
  const winsOnly = closedCount > 0 && winCount > 0 && lossCount === 0;
  const pfGood = (profitFactor !== null && profitFactor > 1) || winsOnly;

  return [
    {
      label: "Total P&L",
      value: formatCurrency(totalPnl),
      // With a capital figure the same number gains meaning: +$2,470 is a 24.7%
      // account return, which is the reading a trader actually compares.
      subtitle:
        returnOnAccount !== null
          ? `${returnOnAccount >= 0 ? "+" : ""}${returnOnAccount.toFixed(2)}% of account · ${closedCount} closed`
          : `${closedCount} closed trades`,
      icon: DollarSign,
      colorClass: totalPnl >= 0 ? "text-pos" : "text-neg",
      bgGradient:
        totalPnl >= 0
          ? "from-pos/10 to-transparent"
          : "from-neg/10 to-transparent",
      iconBg: totalPnl >= 0 ? "bg-pos/15" : "bg-neg/15",
    },
    {
      label: "Win Rate",
      value: formatPercentage(winRate),
      subtitle: `${winCount} / ${closedCount} trades`,
      icon: Target,
      colorClass: winRate >= 50 ? "text-pos" : "text-warn",
      bgGradient:
        winRate >= 50
          ? "from-pos/10 to-transparent"
          : "from-warn/10 to-transparent",
      iconBg: winRate >= 50 ? "bg-pos/15" : "bg-warn/15",
    },
    {
      label: "Profit Factor",
      // "∞" = wins with no losing trades (unbounded); "—" = genuinely no data.
      value:
        profitFactor !== null
          ? profitFactor.toFixed(2)
          : winsOnly
            ? "∞"
            : "–",
      subtitle:
        profitFactor !== null
          ? profitFactor > 1
            ? "Profitable system"
            : "Needs improvement"
          : winsOnly
            ? "No losing trades"
            : "Not enough data",
      icon: TrendingUp,
      colorClass: pfGood ? "text-pos" : "text-neg",
      bgGradient: pfGood
        ? "from-pos/10 to-transparent"
        : "from-neg/10 to-transparent",
      iconBg: pfGood ? "bg-pos/15" : "bg-neg/15",
    },
    {
      label: "Expectancy",
      // What one trade is worth on average — the number that says whether the
      // system is worth trading, independent of win rate.
      value: expectancy !== null ? formatCurrency(expectancy) : "–",
      // The R average only covers trades that had a stop loss. When that's not
      // every closed trade, say so — otherwise one +3R trade among nine
      // stop-less losers reads as "+3.00R per trade" on a losing system.
      subtitle:
        expectancyR !== null
          ? expectancyR.covered === expectancyR.closed
            ? `${expectancyR.value >= 0 ? "+" : ""}${expectancyR.value.toFixed(2)}R per trade`
            : `${expectancyR.value >= 0 ? "+" : ""}${expectancyR.value.toFixed(2)}R (${expectancyR.covered} of ${expectancyR.closed} with a stop)`
          : expectancy !== null
            ? "Per closed trade"
            : "Not enough data",
      icon: Scale,
      colorClass:
        expectancy === null
          ? "text-muted-foreground"
          : expectancy >= 0
            ? "text-pos"
            : "text-neg",
      bgGradient:
        expectancy === null
          ? "from-muted/40 to-transparent"
          : expectancy >= 0
            ? "from-pos/10 to-transparent"
            : "from-neg/10 to-transparent",
      iconBg:
        expectancy === null
          ? "bg-muted"
          : expectancy >= 0
            ? "bg-pos/15"
            : "bg-neg/15",
    },
    {
      label: "Payoff Ratio",
      // Average win vs average loss — what makes a sub-50% win rate survivable.
      value: payoff !== null ? `${payoff.toFixed(2)}:1` : winsOnly ? "∞" : "–",
      subtitle:
        payoff !== null
          ? `Avg win vs avg loss`
          : winsOnly
            ? "No losing trades"
            : "Not enough data",
      icon: Percent,
      colorClass:
        payoff === null
          ? winsOnly
            ? "text-pos"
            : "text-muted-foreground"
          : payoff >= 1
            ? "text-pos"
            : "text-warn",
      bgGradient:
        payoff === null && !winsOnly
          ? "from-muted/40 to-transparent"
          : payoff === null || payoff >= 1
            ? "from-pos/10 to-transparent"
            : "from-warn/10 to-transparent",
      iconBg:
        payoff === null && !winsOnly
          ? "bg-muted"
          : payoff === null || payoff >= 1
            ? "bg-pos/15"
            : "bg-warn/15",
    },
    {
      label: "Max Drawdown",
      // As a % of the peak balance when the account size is known — the only
      // reading that says whether a drawdown was survivable.
      value:
        drawdownPercent !== null
          ? `${drawdownPercent.toFixed(2)}%`
          : formatCurrency(maxDrawdown),
      subtitle:
        drawdownPercent !== null
          ? wiped
            ? `Account wiped · ${formatCurrency(maxDrawdown)} peak to trough`
            : `${formatCurrency(maxDrawdown)} peak to trough`
          : "Peak to trough",
      icon: TrendingDown,
      colorClass: "text-neg",
      bgGradient: "from-neg/10 to-transparent",
      iconBg: "bg-neg/15",
    },
  ];
}

export function StatsCards({ trades, startingCapital }: StatsCardsProps) {
  const cards = buildCards(trades, startingCapital);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.label}
            className={cn(
              "relative overflow-hidden border-border bg-card",
              "bg-gradient-to-br",
              card.bgGradient,
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </p>
                <div className={cn("rounded-lg p-2", card.iconBg)}>
                  <Icon className={cn("h-4 w-4", card.colorClass)} />
                </div>
              </div>
              <p className={cn("mt-3 text-2xl font-bold tracking-tight", card.colorClass)}>
                {card.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{card.subtitle}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
