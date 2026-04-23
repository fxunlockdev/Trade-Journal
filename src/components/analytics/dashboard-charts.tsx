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
import type { AssetType, JournalColor, Trade } from "@/types/database";

interface DashboardChartsProps {
  readonly trades: readonly Trade[];
  /**
   * Active journal name + colour — shown as a small pill above the filter
   * bar so users always know which workspace these stats belong to.
   * Optional for backward compatibility.
   */
  readonly journalName?: string;
  readonly journalColor?: JournalColor;
}

type AssetFilter = "all" | AssetType;

const ASSET_FILTERS: ReadonlyArray<{ readonly value: AssetFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
  { value: "metal", label: "Metals" },
  { value: "index", label: "Indices" },
  { value: "commodity", label: "Commodities" },
];

const COLOR_DOT: Record<JournalColor, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  lime: "bg-lime-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

function ChartSkeleton({ height = "h-[350px]" }: { readonly height?: string }) {
  return <Skeleton className={`w-full rounded-lg bg-muted ${height}`} />;
}

export function DashboardCharts({
  trades,
  journalName,
  journalColor,
}: DashboardChartsProps) {
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("all");
  const [direction, setDirection] = useState<"all" | "buy" | "sell">("all");
  const [asset, setAsset] = useState<AssetFilter>("all");

  // Only show asset filter buttons for classes that actually appear in this
  // journal's trades — hiding empty categories keeps the bar clean.
  const availableAssets = useMemo(() => {
    const present = new Set<AssetType>();
    for (const t of trades) present.add(t.asset_type);
    return ASSET_FILTERS.filter(
      (f) => f.value === "all" || present.has(f.value as AssetType),
    );
  }, [trades]);

  const filteredTrades = useMemo(() => {
    let result = [...trades];

    if (dateRange !== "all") {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      // Anchor cutoff to start-of-day so "7D" means the last 7 full days
      // regardless of the current wall-clock time (3pm vs 9am). Otherwise
      // the same trade oscillates in/out of the window across refreshes.
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - days);
      result = result.filter(t => new Date(t.entry_time) >= cutoff);
    }

    if (direction !== "all") {
      result = result.filter(t => t.direction === direction);
    }

    if (asset !== "all") {
      result = result.filter((t) => t.asset_type === asset);
    }

    return result as readonly Trade[];
  }, [trades, dateRange, direction, asset]);

  const { period, setPeriod } = useAnalytics(filteredTrades);

  return (
    <div className="space-y-6">
      {/* Active journal indicator — scope is always visible */}
      {journalName && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Showing:</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
            {journalColor && (
              <span className={cn("size-2 rounded-full", COLOR_DOT[journalColor])} />
            )}
            {journalName}
          </span>
          <span className="hidden sm:inline">
            · {filteredTrades.length} of {trades.length} trade
            {trades.length === 1 ? "" : "s"} match current filters
          </span>
        </div>
      )}

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

        {availableAssets.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Asset</span>
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
              {availableAssets.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAsset(a.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                    asset === a.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
