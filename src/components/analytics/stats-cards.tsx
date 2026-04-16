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

  const closedCount = trades.filter(
    (t) => t.exit_price !== null && t.pnl_absolute !== null,
  ).length;
  const winCount = trades.filter(
    (t) => t.pnl_absolute !== null && t.pnl_absolute > 0,
  ).length;

  return [
    {
      label: "Total P&L",
      value: formatCurrency(totalPnl),
      subtitle: `${closedCount} closed trades`,
      icon: DollarSign,
      colorClass: totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
      bgGradient:
        totalPnl >= 0
          ? "from-emerald-500/10 to-transparent"
          : "from-red-500/10 to-transparent",
      iconBg: totalPnl >= 0 ? "bg-emerald-500/15" : "bg-red-500/15",
    },
    {
      label: "Win Rate",
      value: formatPercentage(winRate),
      subtitle: `${winCount} / ${closedCount} trades`,
      icon: Target,
      colorClass: winRate >= 50 ? "text-emerald-400" : "text-amber-400",
      bgGradient:
        winRate >= 50
          ? "from-emerald-500/10 to-transparent"
          : "from-amber-500/10 to-transparent",
      iconBg: winRate >= 50 ? "bg-emerald-500/15" : "bg-amber-500/15",
    },
    {
      label: "Profit Factor",
      value: profitFactor === Infinity ? "---" : profitFactor.toFixed(2),
      subtitle: profitFactor > 1 ? "Profitable system" : "Needs improvement",
      icon: TrendingUp,
      colorClass: profitFactor > 1 ? "text-emerald-400" : "text-red-400",
      bgGradient:
        profitFactor > 1
          ? "from-emerald-500/10 to-transparent"
          : "from-red-500/10 to-transparent",
      iconBg: profitFactor > 1 ? "bg-emerald-500/15" : "bg-red-500/15",
    },
    {
      label: "Max Drawdown",
      value: formatCurrency(maxDrawdown),
      subtitle: "Peak to trough",
      icon: TrendingDown,
      colorClass: "text-red-400",
      bgGradient: "from-red-500/10 to-transparent",
      iconBg: "bg-red-500/15",
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
              "relative overflow-hidden border-zinc-800 bg-zinc-900",
              "bg-gradient-to-br",
              card.bgGradient,
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {card.label}
                </p>
                <div className={cn("rounded-lg p-2", card.iconBg)}>
                  <Icon className={cn("h-4 w-4", card.colorClass)} />
                </div>
              </div>
              <p className={cn("mt-3 text-2xl font-bold tracking-tight", card.colorClass)}>
                {card.value}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{card.subtitle}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
