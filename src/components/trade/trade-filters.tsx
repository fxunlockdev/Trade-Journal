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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMOTIONS, type EmotionState } from "@/lib/constants/emotions";

export interface TradeFilters {
  readonly from?: string;
  readonly to?: string;
  readonly instrument?: string;
  readonly pnl_filter?: "profit" | "loss" | "all";
  readonly tags?: string;
  /** Filters on the entry ("when trading") emotion. */
  readonly emotion?: EmotionState;
}

interface TradeFiltersProps {
  readonly onFilterChange: (filters: TradeFilters) => void;
}

type DatePreset = "all" | "week" | "month" | "year" | "custom";

const PNL_OPTIONS = [
  { value: "all", label: "All" },
  { value: "profit", label: "Profit" },
  { value: "loss", label: "Loss" },
] as const;

const DATE_PRESETS: ReadonlyArray<{ readonly value: DatePreset; readonly label: string }> = [
  { value: "all", label: "All Time" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

/** Compute ISO YYYY-MM-DD from/to for a given preset. Returns null for "all"/"custom". */
function getPresetRange(preset: DatePreset): { from: string; to: string } | null {
  if (preset === "all" || preset === "custom") return null;

  const now = new Date();
  const toDate = format(now, "yyyy-MM-dd");

  if (preset === "week") {
    // Monday = start of week (ISO convention)
    const day = now.getDay(); // 0=Sun … 6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    return { from: format(monday, "yyyy-MM-dd"), to: toDate };
  }
  if (preset === "month") {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: format(firstOfMonth, "yyyy-MM-dd"), to: toDate };
  }
  // year
  const firstOfYear = new Date(now.getFullYear(), 0, 1);
  return { from: format(firstOfYear, "yyyy-MM-dd"), to: toDate };
}

export function TradeFiltersBar({ onFilterChange }: TradeFiltersProps) {
  const [filters, setFilters] = useState<TradeFilters>({
    pnl_filter: "all",
  });
  const [activePreset, setActivePreset] = useState<DatePreset>("all");

  const applyFilters = useCallback(
    (next: TradeFilters) => {
      setFilters(next);
      onFilterChange(next);
    },
    [onFilterChange],
  );

  const updateFilter = useCallback(
    (patch: Partial<TradeFilters>) => {
      applyFilters({ ...filters, ...patch });
    },
    [filters, applyFilters],
  );

  // When a date preset pill is clicked
  const handlePresetClick = useCallback(
    (preset: DatePreset) => {
      setActivePreset(preset);
      const range = getPresetRange(preset);
      if (range) {
        applyFilters({ ...filters, from: range.from, to: range.to });
      } else {
        // "all" — clear the date range
        applyFilters({ ...filters, from: undefined, to: undefined });
      }
    },
    [filters, applyFilters],
  );

  // When the calendar pickers are manually changed, switch to "custom" (no
  // preset pill highlighted). Clearing a date back to undefined resets the
  // pill row to "All Time" so the UI stays consistent with the filter state.
  const handleFromPicker = useCallback(
    (date: Date | undefined) => {
      setActivePreset(date ? "custom" : "all");
      updateFilter({ from: date ? format(date, "yyyy-MM-dd") : undefined });
    },
    [updateFilter],
  );

  const handleToPicker = useCallback(
    (date: Date | undefined) => {
      setActivePreset(date ? "custom" : "all");
      updateFilter({ to: date ? format(date, "yyyy-MM-dd") : undefined });
    },
    [updateFilter],
  );

  const clearFilters = useCallback(() => {
    const cleared: TradeFilters = { pnl_filter: "all" };
    setActivePreset("all");
    setFilters(cleared);
    onFilterChange(cleared);
  }, [onFilterChange]);

  // Use `||` not `??` — `??` only short-circuits on null/undefined, so once
  // filters.from is a non-empty string the chain stops there. We want the
  // clear-button to appear when ANY filter is active, including
  // pnl_filter = "profit"/"loss" when all string fields are undefined.
  const hasActiveFilters = Boolean(
    filters.from ||
      filters.to ||
      filters.instrument ||
      filters.tags ||
      filters.emotion ||
      (filters.pnl_filter && filters.pnl_filter !== "all"),
  );

  // Parse YYYY-MM-DD back to a Date for the calendar selected prop
  const fromDate = filters.from ? new Date(`${filters.from}T00:00:00`) : undefined;
  const toDate = filters.to ? new Date(`${filters.to}T00:00:00`) : undefined;

  return (
    <div className="space-y-3">
      {/* ── Quick date preset pills ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => handlePresetClick(preset.value)}
            className={cn(
              "h-7 px-3 rounded-full text-xs font-medium border transition-colors",
              // "All Time" is active whenever no date range is set (regardless
              // of how it was cleared). Other presets track the last-clicked pill.
              (preset.value === "all"
                ? !filters.from && !filters.to
                : activePreset === preset.value)
                ? "bg-primary border-primary text-primary-foreground"
                : "bg-transparent border-border/40 text-muted-foreground hover:border-primary/60 hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* ── Detailed filters row ── */}
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
              {filters.from
                ? format(new Date(`${filters.from}T00:00:00`), "MMM dd, yyyy")
                : "Start date"}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDate}
                onSelect={handleFromPicker}
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
              {filters.to
                ? format(new Date(`${filters.to}T00:00:00`), "MMM dd, yyyy")
                : "End date"}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                onSelect={handleToPicker}
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
            onChange={(e) =>
              updateFilter({ instrument: e.target.value || undefined })
            }
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
                  filters.pnl_filter === opt.value ||
                    (!filters.pnl_filter && opt.value === "all")
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
            onChange={(e) =>
              updateFilter({ tags: e.target.value || undefined })
            }
          />
        </div>

        {/* Emotion (entry) */}
        <div className="space-y-1.5 w-full sm:w-auto">
          <Label className="text-xs text-muted-foreground">Emotion</Label>
          <Select
            value={filters.emotion ?? "all"}
            onValueChange={(v) =>
              updateFilter({
                emotion: v === "all" ? undefined : (v as EmotionState),
              })
            }
          >
            <SelectTrigger className="h-9 w-full text-sm sm:w-[150px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All emotions</SelectItem>
              {EMOTIONS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.emoji} {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </div>
  );
}
