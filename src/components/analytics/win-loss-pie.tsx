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
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{item.name}</p>
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
  // "Closed" = has a computed pnl_absolute. Multi-TP trades close via
  // tp_results (pnl populated, exit_price stays null), so filtering on
  // exit_price would silently hide them from the pie chart.
  const closed = trades.filter(
    (t) => t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute),
  );
  // Strict classification — `losses = total - wins` previously absorbed
  // break-even trades (pnl === 0) into the loss bucket, distorting the pie.
  const wins = closed.filter((t) => t.pnl_absolute! > 0).length;
  const losses = closed.filter((t) => t.pnl_absolute! < 0).length;
  const breakeven = closed.filter((t) => t.pnl_absolute === 0).length;
  const winRate = computeWinRate(trades);

  if (closed.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No closed trades yet
      </div>
    );
  }

  const data: readonly PieSlice[] = [
    { name: "Wins", value: wins, color: "var(--pos)" },
    { name: "Losses", value: losses, color: "var(--neg)" },
    ...(breakeven > 0
      ? [{ name: "Break-even", value: breakeven, color: "var(--muted-foreground)" }]
      : []),
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
        <p className="text-2xl font-bold text-foreground">
          {formatPercentage(winRate)}
        </p>
        <p className="text-xs text-muted-foreground">Win Rate</p>
      </div>
    </div>
  );
}
