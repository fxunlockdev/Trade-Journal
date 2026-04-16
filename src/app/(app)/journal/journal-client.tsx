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

    if (filters.from) {
      const fromDate = new Date(filters.from);
      result = result.filter((t) => new Date(t.entry_time) >= fromDate);
    }

    if (filters.to) {
      const toDate = new Date(filters.to);
      result = result.filter((t) => new Date(t.entry_time) <= toDate);
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
