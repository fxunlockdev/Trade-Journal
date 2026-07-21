"use client";

import {
  DollarSign,
  Target,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  computeTotalPnl,
  computeWinRate,
  computeProfitFactor,
  computeMaxDrawdown,
} from "@/lib/trades/analytics";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface StatsCardsProps {
  readonly trades: readonly Trade[];
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

function buildCards(trades: readonly Trade[]): readonly StatCardData[] {
  const totalPnl = computeTotalPnl(trades);
  const winRate = computeWinRate(trades);
  const profitFactor = computeProfitFactor(trades);
  const maxDrawdown = computeMaxDrawdown(trades);

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
      subtitle: `${closedCount} closed trades`,
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
            : "—",
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
      label: "Max Drawdown",
      value: formatCurrency(maxDrawdown),
      subtitle: "Peak to trough",
      icon: TrendingDown,
      colorClass: "text-neg",
      bgGradient: "from-neg/10 to-transparent",
      iconBg: "bg-neg/15",
    },
  ];
}

export function StatsCards({ trades }: StatsCardsProps) {
  const cards = buildCards(trades);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
