"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { computeEquityCurve } from "@/lib/trades/analytics";
import { formatCurrency } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface DrawdownChartProps {
  readonly trades: readonly Trade[];
}

interface DrawdownPoint {
  readonly date: string;
  readonly drawdown: number;
}

interface TooltipPayloadItem {
  readonly value: number;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayloadItem[];
  readonly label?: string;
}

function computeDrawdownSeries(
  trades: readonly Trade[],
): readonly DrawdownPoint[] {
  const equity = computeEquityCurve(trades);
  if (equity.length === 0) return [];

  // Peak must track the running max regardless of sign. Initialising to 0
  // meant accounts that started with losses reported zero drawdown until
  // equity went positive, which is wrong — drawdown is always peak minus
  // current, and peak is the highest point the equity has ever reached.
  let peak = equity[0].cumPnl;

  return equity.map((point) => {
    if (point.cumPnl > peak) peak = point.cumPnl;
    const drawdown = peak - point.cumPnl;
    return { date: point.date, drawdown: -drawdown };
  });
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const value = payload[0].value;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">
        {label
          ? new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : ""}
      </p>
      <p className="text-sm font-semibold text-red-400">
        {formatCurrency(Math.abs(value))}
      </p>
    </div>
  );
}

function formatXAxisDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DrawdownChart({ trades }: DrawdownChartProps) {
  const data = computeDrawdownSeries(trades);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No closed trades yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#27272a"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxisDate}
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatCurrency(Math.abs(v))}
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="drawdown"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#drawdownGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#ef4444", stroke: "#09090b", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
