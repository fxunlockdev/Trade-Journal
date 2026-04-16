"use client";

import { Suspense, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCards } from "@/components/analytics/stats-cards";
import { EquityCurve } from "@/components/analytics/equity-curve";
import { PnlChart } from "@/components/analytics/pnl-chart";
import { WinLossPie } from "@/components/analytics/win-loss-pie";
import { DrawdownChart } from "@/components/analytics/drawdown-chart";
import { TimeFilter } from "@/components/analytics/time-filter";
import { useAnalytics } from "@/hooks/use-analytics";
import type { Trade } from "@/types/database";

interface DashboardChartsProps {
  readonly trades: readonly Trade[];
}

function ChartSkeleton({ height = "h-[350px]" }: { readonly height?: string }) {
  return <Skeleton className={`w-full rounded-lg bg-muted ${height}`} />;
}

export function DashboardCharts({ trades }: DashboardChartsProps) {
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("all");
  const [direction, setDirection] = useState<"all" | "buy" | "sell">("all");

  const filteredTrades = useMemo(() => {
    let result = [...trades];

    if (dateRange !== "all") {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      result = result.filter(t => new Date(t.entry_time) >= cutoff);
    }

    if (direction !== "all") {
      result = result.filter(t => t.direction === direction);
    }

    return result as readonly Trade[];
  }, [trades, dateRange, direction]);

  const { period, setPeriod } = useAnalytics(filteredTrades);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Range</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            {(["7d", "30d", "90d", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDateRange(r)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  dateRange === r
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r === "7d" ? "7D" : r === "30d" ? "30D" : r === "90d" ? "90D" : "All"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Direction</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            {(["all", "buy", "sell"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-all",
                  direction === d
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Group by</span>
          <TimeFilter value={period} onChange={setPeriod} />
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {filteredTrades.length} {filteredTrades.length === 1 ? "trade" : "trades"}
        </div>
      </div>

      <StatsCards trades={filteredTrades} />

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ChartSkeleton />}>
            <EquityCurve trades={filteredTrades} />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              P&L by Period
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton />}>
              <PnlChart trades={filteredTrades} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Win / Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton height="h-[280px]" />}>
              <WinLossPie trades={filteredTrades} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Drawdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ChartSkeleton height="h-[280px]" />}>
            <DrawdownChart trades={filteredTrades} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
