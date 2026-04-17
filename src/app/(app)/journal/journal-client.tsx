"use client";

import { useCallback, useMemo, useState } from "react";
import type { Trade } from "@/types/database";
import { TradeTable } from "@/components/trade/trade-table";
import { TradeFiltersBar, type TradeFilters } from "@/components/trade/trade-filters";

interface JournalClientProps {
  readonly trades: readonly Trade[];
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

    return result;
  }, [trades, filters]);

  return (
    <div className="space-y-4">
      <TradeFiltersBar onFilterChange={handleFilterChange} />
      <TradeTable trades={filtered} />
    </div>
  );
}
