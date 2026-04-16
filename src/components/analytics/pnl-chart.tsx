"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { groupTradesByPeriod, type Period } from "@/lib/trades/analytics";
import { formatCurrency, formatPercentage } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface PnlChartProps {
  readonly trades: readonly Trade[];
  readonly period: Period;
}

interface PeriodBarData {
  readonly period: string;
  readonly pnl: number;
  readonly tradeCount: number;
  readonly winRate: number;
}

interface TooltipPayloadItem {
  readonly payload: PeriodBarData;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayloadItem[];
}

function ChartTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-foreground">{data.period}</p>
      <p
        className={`text-sm font-semibold ${data.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
      >
        {formatCurrency(data.pnl)}
      </p>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p>{data.tradeCount} trades</p>
        <p>Win rate: {formatPercentage(data.winRate)}</p>
      </div>
    </div>
  );
}

export function PnlChart({ trades, period }: PnlChartProps) {
  const data = groupTradesByPeriod(trades, period);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No closed trades yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#27272a"
          vertical={false}
        />
        <XAxis
          dataKey="period"
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatCurrency(v)}
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry) => (
            <Cell
              key={entry.period}
              fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
