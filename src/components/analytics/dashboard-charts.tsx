"use client";

import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const { period, setPeriod } = useAnalytics(trades);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <TimeFilter value={period} onChange={setPeriod} />
      </div>

      <StatsCards trades={trades} />

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ChartSkeleton />}>
            <EquityCurve trades={trades} />
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
              <PnlChart trades={trades} period={period} />
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
              <WinLossPie trades={trades} />
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
            <DrawdownChart trades={trades} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
