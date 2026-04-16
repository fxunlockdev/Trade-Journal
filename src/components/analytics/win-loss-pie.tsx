"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { computeWinRate } from "@/lib/trades/analytics";
import { formatPercentage } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface WinLossPieProps {
  readonly trades: readonly Trade[];
}

interface PieSlice {
  readonly name: string;
  readonly value: number;
  readonly color: string;
}

interface TooltipPayloadItem {
  readonly name: string;
  readonly value: number;
  readonly payload: PieSlice;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayloadItem[];
}

function ChartTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const item = payload[0];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-500">{item.name}</p>
      <p
        className="text-sm font-semibold"
        style={{ color: item.payload.color }}
      >
        {item.value} trades
      </p>
    </div>
  );
}

export function WinLossPie({ trades }: WinLossPieProps) {
  const closed = trades.filter(
    (t) => t.exit_price !== null && t.pnl_absolute !== null,
  );
  const wins = closed.filter((t) => t.pnl_absolute! > 0).length;
  const losses = closed.length - wins;
  const winRate = computeWinRate(trades);

  if (closed.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        No closed trades yet
      </div>
    );
  }

  const data: readonly PieSlice[] = [
    { name: "Wins", value: wins, color: "#10b981" },
    { name: "Losses", value: losses, color: "#ef4444" },
  ];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} fillOpacity={0.9} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-bold text-slate-900">
          {formatPercentage(winRate)}
        </p>
        <p className="text-xs text-slate-500">Win Rate</p>
      </div>
    </div>
  );
}
