"use client";

import { useCallback, useState } from "react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface TradeFilters {
  readonly from?: string;
  readonly to?: string;
  readonly instrument?: string;
  readonly pnl_filter?: "profit" | "loss" | "all";
  readonly tags?: string;
}

interface TradeFiltersProps {
  readonly onFilterChange: (filters: TradeFilters) => void;
}

const PNL_OPTIONS = [
  { value: "all", label: "All" },
  { value: "profit", label: "Profit" },
  { value: "loss", label: "Loss" },
] as const;

export function TradeFiltersBar({ onFilterChange }: TradeFiltersProps) {
  const [filters, setFilters] = useState<TradeFilters>({
    pnl_filter: "all",
  });

  const updateFilter = useCallback(
    (patch: Partial<TradeFilters>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      onFilterChange(next);
    },
    [filters, onFilterChange],
  );

  const clearFilters = useCallback(() => {
    const cleared: TradeFilters = { pnl_filter: "all" };
    setFilters(cleared);
    onFilterChange(cleared);
  }, [onFilterChange]);

  const hasActiveFilters =
    filters.from ||
    filters.to ||
    filters.instrument ||
    filters.tags ||
    (filters.pnl_filter && filters.pnl_filter !== "all");

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
      {/* Date From */}
      <div className="space-y-1.5 w-full sm:w-auto">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className={cn(
                  "w-full sm:w-[150px] justify-start text-left font-normal h-9 text-sm",
                  !filters.from && "text-muted-foreground",
                )}
              />
            }
          >
            {filters.from ? format(new Date(filters.from), "MMM dd, yyyy") : "Start date"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={filters.from ? new Date(filters.from) : undefined}
              onSelect={(date) =>
                updateFilter({ from: date?.toISOString() ?? undefined })
              }
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Date To */}
      <div className="space-y-1.5 w-full sm:w-auto">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className={cn(
                  "w-full sm:w-[150px] justify-start text-left font-normal h-9 text-sm",
                  !filters.to && "text-muted-foreground",
                )}
              />
            }
          >
            {filters.to ? format(new Date(filters.to), "MMM dd, yyyy") : "End date"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={filters.to ? new Date(filters.to) : undefined}
              onSelect={(date) =>
                updateFilter({ to: date?.toISOString() ?? undefined })
              }
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Instrument */}
      <div className="space-y-1.5 w-full sm:w-auto">
        <Label className="text-xs text-muted-foreground">Instrument</Label>
        <Input
          placeholder="e.g. EURUSD"
          className="h-9 text-sm w-full sm:w-[140px]"
          value={filters.instrument ?? ""}
          onChange={(e) => updateFilter({ instrument: e.target.value || undefined })}
        />
      </div>

      {/* PnL Filter */}
      <div className="space-y-1.5 w-full sm:w-auto">
        <Label className="text-xs text-muted-foreground">P&L</Label>
        <div className="flex rounded-md border border-border/40 overflow-hidden h-9">
          {PNL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "px-3 text-xs font-medium transition-colors",
                filters.pnl_filter === opt.value || (!filters.pnl_filter && opt.value === "all")
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
              onClick={() => updateFilter({ pnl_filter: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5 w-full sm:w-auto">
        <Label className="text-xs text-muted-foreground">Tags</Label>
        <Input
          placeholder="scalp, trend..."
          className="h-9 text-sm w-full sm:w-[140px]"
          value={filters.tags ?? ""}
          onChange={(e) => updateFilter({ tags: e.target.value || undefined })}
        />
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs text-muted-foreground"
          onClick={clearFilters}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
