"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  addMonths,
  buildMonthView,
  initialMonth,
  type CalendarCell,
} from "@/lib/trades/calendar";
import type { Trade } from "@/types/database";

interface MonthlyPnlCalendarProps {
  readonly trades: readonly Trade[];
  /**
   * Dashboard-widget mode: shorter day cells and an inline one-line summary
   * instead of the four stat pills. Pair with `viewAllHref`.
   */
  readonly compact?: boolean;
  /** When set, renders a "Full calendar →" link in the header. */
  readonly viewAllHref?: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Compact, signed money for a dense grid cell: +$1.7k / -$86 / +$1.20.
 * Cents are kept only under $10 (where they carry meaning); the exact figure
 * is always available in the cell's hover title and the month summary.
 */
function compactSigned(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 10) return `${sign}$${Math.round(abs)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function DayCell({
  cell,
  compact,
}: {
  readonly cell: CalendarCell;
  readonly compact?: boolean;
}) {
  const { inMonth, isToday, day } = cell;
  // Spill-over days (previous/next month) show only a faded number — their
  // P&L belongs to a different month and is excluded from this month's totals.
  const stats = inMonth ? cell.stats : null;
  const pnl = stats?.pnl ?? 0;
  const tone = !stats ? "flat" : pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat";

  const title = stats
    ? `${new Date(cell.iso + "T00:00:00Z").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })} · ${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)} · ${stats.tradeCount} ${
        stats.tradeCount === 1 ? "trade" : "trades"
      } · ${Math.round(stats.winRate)}% win`
    : undefined;

  return (
    <div
      title={title}
      className={cn(
        "flex flex-col rounded-lg border p-1 transition-colors sm:p-2",
        compact
          ? "min-h-[44px] sm:min-h-[62px]"
          : "min-h-[56px] sm:min-h-[84px]",
        !inMonth && "opacity-40",
        tone === "pos" && "border-pos/25 bg-pos/10 dark:bg-pos/15",
        tone === "neg" && "border-neg/25 bg-neg/10 dark:bg-neg/15",
        tone === "flat" && stats && "border-border bg-muted/50",
        tone === "flat" && !stats && "border-border/60",
        isToday && "ring-2 ring-ring ring-offset-1 ring-offset-background",
      )}
    >
      <span
        className={cn(
          "text-[11px] font-medium leading-none",
          isToday ? "font-bold text-foreground" : "text-muted-foreground",
        )}
      >
        {day}
      </span>

      {stats && (
        <div className="mt-auto min-w-0">
          <p
            className={cn(
              "truncate text-[10px] font-bold tabular-nums sm:text-sm",
              tone === "pos" && "text-pos",
              tone === "neg" && "text-neg",
              tone === "flat" && "text-muted-foreground",
            )}
          >
            {compactSigned(pnl)}
          </p>
          <p className="truncate text-[9px] text-muted-foreground sm:text-[11px]">
            {Math.round(stats.winRate)}%
            <span className="hidden sm:inline">
              {" · "}
              {stats.tradeCount}
              {stats.tradeCount === 1 ? " trade" : " trades"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  valueClass,
}: {
  readonly label: string;
  readonly value: string;
  readonly valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-sm font-bold tabular-nums", valueClass)}>{value}</p>
    </div>
  );
}

export function MonthlyPnlCalendar({
  trades,
  compact = false,
  viewAllHref,
}: MonthlyPnlCalendarProps) {
  const [{ year, month }, setYm] = useState(() => initialMonth(trades));

  const view = useMemo(
    () => buildMonthView(trades, year, month),
    [trades, year, month],
  );

  // Cap forward navigation at the current month — nothing lives in the future.
  const now = new Date();
  const atCurrentMonth =
    year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month >= now.getUTCMonth());

  const go = (delta: number) => setYm((cur) => addMonths(cur.year, cur.month, delta));
  const goToday = () =>
    setYm({ year: now.getUTCFullYear(), month: now.getUTCMonth() });

  const netStr = `${view.monthPnl >= 0 ? "+" : ""}${formatCurrency(view.monthPnl)}`;
  const netClass =
    view.monthPnl > 0
      ? "text-pos"
      : view.monthPnl < 0
        ? "text-neg"
        : "text-muted-foreground";

  return (
    <section className="space-y-4">
      {/* Header: navigation + month totals */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => go(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[9.5rem] text-center text-lg font-bold text-foreground">
            {view.label}
          </h2>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => go(1)}
            disabled={atCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          {!atCurrentMonth && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={goToday}
            >
              This month
            </Button>
          )}
        </div>

        {compact ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Net </span>
              <span className={cn("font-bold tabular-nums", netClass)}>
                {netStr}
              </span>
            </span>
            <span className="text-muted-foreground">
              {view.totalTrades > 0
                ? `${Math.round(view.winRate)}% win · ${view.totalTrades} trade${
                    view.totalTrades === 1 ? "" : "s"
                  }`
                : "no trades"}
            </span>
            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="font-medium text-primary hover:text-primary/80"
              >
                Full calendar →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="Net P&L" value={netStr} valueClass={netClass} />
            <SummaryPill
              label="Win Rate"
              value={view.totalTrades > 0 ? `${Math.round(view.winRate)}%` : "–"}
            />
            <SummaryPill
              label="Days"
              value={`${view.greenDays}G / ${view.redDays}R`}
            />
            <SummaryPill label="Trades" value={String(view.totalTrades)} />
            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="ml-1 text-sm font-medium text-primary hover:text-primary/80"
              >
                Full calendar →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5 sm:gap-2">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "pb-1 text-center text-[10px] font-semibold uppercase tracking-wider sm:text-xs",
              i >= 5 ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
          >
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="space-y-1 sm:space-y-2">
        {view.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5 sm:gap-2">
            {week.cells.map((cell) => (
              <DayCell key={cell.iso} cell={cell} compact={compact} />
            ))}
          </div>
        ))}
      </div>

      {view.totalTrades === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          No closed trades in {view.label}.
        </p>
      )}
    </section>
  );
}
