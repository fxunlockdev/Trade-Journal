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

interface EquityCurveProps {
  readonly trades: readonly Trade[];
}

interface TooltipPayloadItem {
  readonly value: number;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayloadItem[];
  readonly label?: string;
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const value = payload[0].value;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-400">
        {label
          ? new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : ""}
      </p>
      <p
        className={`text-sm font-semibold ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function formatXAxisDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EquityCurve({ trades }: EquityCurveProps) {
  const data = computeEquityCurve(trades);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        No closed trades yet
      </div>
    );
  }

  const dataWithOrigin = [{ date: data[0].date, cumPnl: 0 }, ...data];

  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart
        data={dataWithOrigin}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
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
          tickFormatter={(v: number) => formatCurrency(v)}
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="cumPnl"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#equityGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#10b981", stroke: "#09090b", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
