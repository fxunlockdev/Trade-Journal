"use client";

import { useCallback, useMemo, useState } from "react";
import type { Trade } from "@/types/database";
import { cn } from "@/lib/utils";
import { TradeTable } from "@/components/trade/trade-table";
import { TradeFiltersBar, type TradeFilters } from "@/components/trade/trade-filters";

interface JournalClientProps {
  readonly trades: readonly Trade[];
}

interface PeriodStats {
  readonly closed: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly totalPnl: number;
  readonly avgRR: number | null;
}

function computePeriodStats(trades: readonly Trade[]): PeriodStats {
  const closed = trades.filter(
    (t) => t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute),
  );
  const wins = closed.filter((t) => t.pnl_absolute! > 0).length;
  const losses = closed.filter((t) => t.pnl_absolute! < 0).length;
  const totalPnl = closed.reduce((sum, t) => sum + t.pnl_absolute!, 0);
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  const rrTrades = closed.filter(
    (t) => t.risk_reward_ratio !== null && Number.isFinite(t.risk_reward_ratio),
  );
  const avgRR =
    rrTrades.length > 0
      ? rrTrades.reduce((sum, t) => sum + t.risk_reward_ratio!, 0) /
        rrTrades.length
      : null;

  return { closed: closed.length, wins, losses, winRate, totalPnl, avgRR };
}

function PeriodSummary({ trades }: { readonly trades: readonly Trade[] }) {
  const stats = useMemo(() => computePeriodStats(trades), [trades]);

  if (trades.length === 0) return null;

  const pnlPositive = stats.totalPnl > 0;
  const pnlNeutral = stats.totalPnl === 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {/* Period P&L */}
      <div className="col-span-2 sm:col-span-1 lg:col-span-1 rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Period P&L
        </p>
        <p
          className={cn(
            "mt-1 text-lg font-bold tabular-nums",
            pnlNeutral
              ? "text-muted-foreground"
              : pnlPositive
                ? "text-pos"
                : "text-neg",
          )}
        >
          {stats.totalPnl >= 0 ? "+" : ""}
          {stats.totalPnl.toFixed(2)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {stats.closed} closed trade{stats.closed !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Win / Loss */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Wins / Losses
        </p>
        <p className="mt-1 text-lg font-bold">
          <span className="text-pos">{stats.wins}</span>
          <span className="text-muted-foreground mx-1">/</span>
          <span className="text-neg">{stats.losses}</span>
        </p>
        <p className="text-[10px] text-muted-foreground">closed trades</p>
      </div>

      {/* Win Rate */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Win Rate
        </p>
        <p
          className={cn(
            "mt-1 text-lg font-bold",
            stats.winRate >= 50 ? "text-pos" : "text-neg",
          )}
        >
          {stats.winRate.toFixed(1)}%
        </p>
        <p className="text-[10px] text-muted-foreground">of closed trades</p>
      </div>

      {/* Avg R:R */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Avg R:R
        </p>
        <p className="mt-1 text-lg font-bold text-foreground">
          {stats.avgRR !== null ? `${stats.avgRR.toFixed(2)}R` : "—"}
        </p>
        <p className="text-[10px] text-muted-foreground">across closed trades</p>
      </div>

      {/* Open trades badge */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Open
        </p>
        <p className="mt-1 text-lg font-bold text-warn">
          {trades.length - stats.closed}
        </p>
        <p className="text-[10px] text-muted-foreground">
          of {trades.length} total
        </p>
      </div>
    </div>
  );
}

export function JournalClient({ trades }: JournalClientProps) {
  const [filters, setFilters] = useState<TradeFilters>({});

  const handleFilterChange = useCallback((next: TradeFilters) => {
    setFilters(next);
  }, []);

  const filtered = useMemo(() => {
    let result = [...trades];

    // Parse a YYYY-MM-DD string as LOCAL-zone midnight, not UTC midnight.
    // `new Date("2026-04-17")` is UTC-anchored, so calling .setHours(23,...)
    // on it afterwards drifts the cutoff by the user's UTC offset. In UTC+12
    // the "to" date ends at 11:59 UTC (noon local), silently dropping
    // afternoon/evening trades. Construct date parts explicitly instead.
    const parseLocalDate = (
      yyyyMmDd: string,
      hh: number,
      mm: number,
      ss: number,
      ms: number,
    ): Date | null => {
      const parts = yyyyMmDd.split("-").map((p) => Number(p));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
      const [y, m, d] = parts;
      return new Date(y, m - 1, d, hh, mm, ss, ms);
    };

    if (filters.from) {
      const fromDate = parseLocalDate(filters.from, 0, 0, 0, 0);
      if (fromDate && !Number.isNaN(fromDate.getTime())) {
        result = result.filter((t) => new Date(t.entry_time) >= fromDate);
      }
    }

    if (filters.to) {
      const toDate = parseLocalDate(filters.to, 23, 59, 59, 999);
      if (toDate && !Number.isNaN(toDate.getTime())) {
        result = result.filter((t) => new Date(t.entry_time) <= toDate);
      }
    }

    if (filters.instrument) {
      const search = filters.instrument.toUpperCase();
      result = result.filter((t) =>
        t.instrument.toUpperCase().includes(search),
      );
    }

    if (filters.pnl_filter === "profit") {
      result = result.filter(
        (t) => t.pnl_absolute !== null && t.pnl_absolute > 0,
      );
    } else if (filters.pnl_filter === "loss") {
      result = result.filter(
        (t) => t.pnl_absolute !== null && t.pnl_absolute < 0,
      );
    }

    if (filters.tags) {
      const tagList = filters.tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tagList.length > 0) {
        result = result.filter((t) =>
          tagList.some((tag) =>
            t.tags.some((tt) => tt.toLowerCase().includes(tag)),
          ),
        );
      }
    }

    if (filters.emotion) {
      result = result.filter((t) => t.emotion === filters.emotion);
    }

    return result;
  }, [trades, filters]);

  return (
    <div className="space-y-4">
      <TradeFiltersBar onFilterChange={handleFilterChange} />
      <PeriodSummary trades={filtered} />
      <TradeTable trades={filtered} />
    </div>
  );
}
