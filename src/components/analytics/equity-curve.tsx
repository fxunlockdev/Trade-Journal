"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { computeEquityTimeline, type EquityPoint } from "@/lib/trades/balance";
import { cn, formatCurrency } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface EquityCurveProps {
  readonly trades: readonly Trade[];
  /**
   * Journal starting capital. When set, the curve plots the ACCOUNT BALANCE
   * (capital + realized P&L) instead of profit-from-zero, and the % view has a
   * denominator. Omit and it behaves exactly as the old cumulative-P&L chart.
   */
  readonly startingCapital?: number | null;
}

/** Which lens the curve is drawn through. */
type Mode = "balance" | "percent" | "r";

const MODES: readonly { readonly value: Mode; readonly label: string }[] = [
  { value: "balance", label: "$" },
  { value: "percent", label: "Return %" },
  { value: "r", label: "R Multiple" },
];

interface Point {
  readonly date: string;
  readonly value: number;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly { readonly value: number }[];
  readonly label?: string;
  readonly mode: Mode;
}

/** Axis and tooltip formatting for the active lens. Exported for tests. */
export function formatValue(value: number, mode: Mode): string {
  if (mode === "percent") return `${value.toFixed(2)}%`;
  if (mode === "r") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
  return formatCurrency(value);
}

/** The series a lens plots. Exported for tests. */
export function pickModeValue(point: EquityPoint, mode: Mode): number {
  if (mode === "percent") return point.returnPercent;
  if (mode === "r") return point.cumR;
  return point.balance;
}

function ChartTooltip({ active, payload, label, mode }: CustomTooltipProps) {
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
      <p className="text-sm font-semibold text-foreground">
        {formatValue(value, mode)}
      </p>
    </div>
  );
}

function formatXAxisDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EquityCurve({ trades, startingCapital }: EquityCurveProps) {
  const hasCapital =
    startingCapital != null &&
    Number.isFinite(startingCapital) &&
    startingCapital > 0;
  const [mode, setMode] = useState<Mode>("balance");

  const timeline = useMemo(
    () => computeEquityTimeline(trades, startingCapital),
    [trades, startingCapital],
  );

  const data: readonly Point[] = useMemo(
    () => timeline.map((p) => ({ date: p.date, value: pickModeValue(p, mode) })),
    [timeline, mode],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No closed trades yet
      </div>
    );
  }

  // Synthesise an origin one day before the first trade so the baseline and the
  // first trade don't share an X position (which compressed the leftmost
  // segment and broke its tooltip). The origin is the starting balance — the
  // whole point of the balance view is that the line begins at your capital.
  const originValue = mode === "balance" && hasCapital ? startingCapital : 0;
  const firstDate = new Date(data[0].date);
  const originDate = new Date(
    firstDate.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const dataWithOrigin: readonly Point[] = [
    { date: originDate, value: originValue },
    ...data,
  ];

  // Colour by outcome: ending above the baseline is green, below is red.
  const last = data[data.length - 1].value;
  const positive = last >= originValue;
  const stroke = positive ? "var(--pos)" : "var(--neg)";

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Equity curve units"
        className="flex items-center justify-end gap-0.5 rounded-lg border border-border bg-muted p-0.5 w-fit ml-auto"
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            aria-pressed={mode === m.value}
            disabled={m.value === "percent" && !hasCapital}
            title={
              m.value === "percent" && !hasCapital
                ? "Set the journal's account capital to see return %"
                : undefined
            }
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              mode === m.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              m.value === "percent" && !hasCapital && "opacity-40 cursor-not-allowed",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={dataWithOrigin as Point[]}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxisDate}
            stroke="var(--muted-foreground)"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatValue(v, mode)}
            stroke="var(--muted-foreground)"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={80}
            domain={
              mode === "balance" && hasCapital ? ["auto", "auto"] : undefined
            }
          />
          <Tooltip content={<ChartTooltip mode={mode} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill="url(#equityGradient)"
            dot={false}
            activeDot={{ r: 4, fill: stroke, stroke: "var(--card)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
