"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface PerformanceCalendarProps {
  readonly trades: readonly Trade[];
}

interface DayData {
  readonly date: string; // YYYY-MM-DD
  readonly pnl: number;
  readonly tradeCount: number;
}

type PnlTier = 0 | 1 | 2 | 3;

const WEEKS = 12;
const DAYS_IN_GRID = WEEKS * 7; // 84 days
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Build a UTC YYYY-MM-DD key. Both the day-map (from trade.entry_time) and
 * the grid cells must use UTC — mixing local and UTC silently shifts
 * evening trades to the wrong cell for any user west of UTC.
 */
function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPnlTier(absValue: number): PnlTier {
  if (absValue === 0) return 0;
  if (absValue < 50) return 1;
  if (absValue <= 200) return 2;
  return 3;
}

// Static class lookup — Tailwind's content scanner needs the full class
// string to appear literally in source so it isn't purged in production.
// Previously used template-literal concatenation (`bg-emerald-500${opacity}`)
// which got stripped at build time, making the heatmap monochrome in prod.
const WIN_CLASS: Record<Exclude<PnlTier, 0>, string> = {
  1: "bg-emerald-500/30",
  2: "bg-emerald-500/60",
  3: "bg-emerald-500/90",
};
const LOSS_CLASS: Record<Exclude<PnlTier, 0>, string> = {
  1: "bg-red-500/30",
  2: "bg-red-500/60",
  3: "bg-red-500/90",
};

function getDayColor(pnl: number, tier: PnlTier): string {
  if (tier === 0) return "bg-muted opacity-40";
  return pnl >= 0 ? WIN_CLASS[tier] : LOSS_CLASS[tier];
}

function buildDayMap(trades: readonly Trade[]): Map<string, DayData> {
  const map = new Map<string, DayData>();

  for (const trade of trades) {
    // Skip null AND non-finite (NaN/Infinity) — the latter can leak through
    // if pnl_absolute gets corrupted and would pollute every downstream
    // calculation with NaN (making a whole day's tier silently = 0).
    if (
      trade.pnl_absolute === null ||
      !Number.isFinite(trade.pnl_absolute)
    ) {
      continue;
    }
    const date = trade.entry_time.slice(0, 10);
    const existing = map.get(date);
    if (existing) {
      map.set(date, {
        date,
        pnl: existing.pnl + trade.pnl_absolute,
        tradeCount: existing.tradeCount + 1,
      });
    } else {
      map.set(date, { date, pnl: trade.pnl_absolute, tradeCount: 1 });
    }
  }

  return map;
}

function buildGrid(dayMap: Map<string, DayData>): readonly (DayData | null)[][] {
  // Anchor: today at UTC midnight. Using UTC throughout keeps the grid
  // perfectly aligned with `trade.entry_time.slice(0, 10)` (which is UTC).
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // Find Monday of the current UTC week (ISO: Mon=1)
  const todayDow = todayUtc.getUTCDay(); // 0=Sun
  const isoOffset = todayDow === 0 ? 6 : todayDow - 1; // days since Monday
  const thisMonday = new Date(todayUtc);
  thisMonday.setUTCDate(todayUtc.getUTCDate() - isoOffset);

  // Start of grid: 11 weeks before this Monday
  const startDate = new Date(thisMonday);
  startDate.setUTCDate(thisMonday.getUTCDate() - (WEEKS - 1) * 7);

  // Build column-major grid: columns = weeks, rows = Mon-Sun
  const columns: (DayData | null)[][] = [];

  for (let w = 0; w < WEEKS; w++) {
    const col: (DayData | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(startDate);
      cell.setUTCDate(startDate.getUTCDate() + w * 7 + d);
      if (cell.getTime() > todayUtc.getTime()) {
        col.push(null);
      } else {
        const iso = toIsoDate(cell);
        col.push(dayMap.get(iso) ?? { date: iso, pnl: 0, tradeCount: 0 });
      }
    }
    columns.push(col);
  }

  return columns;
}

function getMonthLabels(
  columns: readonly (DayData | null)[][]
): readonly { label: string; colIndex: number }[] {
  const labels: { label: string; colIndex: number }[] = [];
  let lastMonth = "";

  for (let w = 0; w < columns.length; w++) {
    const firstCell = columns[w].find((c) => c !== null);
    if (!firstCell) continue;
    // Parse the YYYY-MM-DD key back as UTC so the month label matches the
    // bucket the cell was placed into (avoids Jan/Feb flicker at boundaries).
    const month = new Date(`${firstCell.date}T00:00:00Z`).toLocaleString(
      "default",
      { month: "short", timeZone: "UTC" },
    );
    if (month !== lastMonth) {
      labels.push({ label: month, colIndex: w });
      lastMonth = month;
    }
  }

  return labels;
}

interface TooltipState {
  readonly dayData: DayData;
  readonly x: number;
  readonly y: number;
}

export function PerformanceCalendar({ trades }: PerformanceCalendarProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { columns, monthLabels, bestDay, worstDay, greenDaysPct } =
    useMemo(() => {
      const dayMap = buildDayMap(trades);
      const cols = buildGrid(dayMap);
      const labels = getMonthLabels(cols);

      const tradingDays = [...dayMap.values()];
      const best = tradingDays.reduce<DayData | null>(
        (acc, d) => (acc === null || d.pnl > acc.pnl ? d : acc),
        null
      );
      const worst = tradingDays.reduce<DayData | null>(
        (acc, d) => (acc === null || d.pnl < acc.pnl ? d : acc),
        null
      );
      const greenCount = tradingDays.filter((d) => d.pnl > 0).length;
      const pct =
        tradingDays.length > 0
          ? Math.round((greenCount / tradingDays.length) * 100)
          : 0;

      return {
        columns: cols,
        monthLabels: labels,
        bestDay: best,
        worstDay: worst,
        greenDaysPct: pct,
      };
    }, [trades]);

  function handleMouseEnter(
    e: React.MouseEvent<HTMLDivElement>,
    day: DayData
  ) {
    if (day.tradeCount === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.closest("[data-calendar]");
    const parentRect = parent?.getBoundingClientRect();
    setTooltip({
      dayData: day,
      x: rect.left - (parentRect?.left ?? 0) + rect.width / 2,
      y: rect.top - (parentRect?.top ?? 0) - 8,
    });
  }

  function handleMouseLeave() {
    setTooltip(null);
  }

  return (
    <div className="space-y-4">
      {/* Heatmap */}
      <div className="relative" data-calendar>
        {/* Month labels row */}
        <div
          className="mb-1 grid"
          style={{ gridTemplateColumns: `20px repeat(${WEEKS}, 1fr)` }}
        >
          <div />
          {Array.from({ length: WEEKS }, (_, w) => {
            const label = monthLabels.find((m) => m.colIndex === w);
            return (
              <div key={w} className="text-[10px] text-muted-foreground px-0.5">
                {label?.label ?? ""}
              </div>
            );
          })}
        </div>

        {/* Grid: day-label column + week columns */}
        <div
          className="grid"
          style={{ gridTemplateColumns: `20px repeat(${WEEKS}, 1fr)` }}
        >
          {/* Day-of-week labels */}
          <div className="flex flex-col gap-0.5">
            {DAY_LABELS.map((day) => (
              <div
                key={day}
                className="flex h-3.5 items-center text-[10px] text-muted-foreground leading-none"
              >
                {day[0]}
              </div>
            ))}
          </div>

          {/* Week columns */}
          {columns.map((col, w) => (
            <div key={w} className="flex flex-col gap-0.5 px-0.5">
              {col.map((day, d) => {
                if (day === null) {
                  return <div key={d} className="h-3.5 w-full rounded-sm" />;
                }
                const tier = getPnlTier(Math.abs(day.pnl));
                const colorClass = getDayColor(day.pnl, tier);
                return (
                  <div
                    key={d}
                    className={cn(
                      "h-3.5 w-full rounded-sm cursor-default transition-opacity",
                      colorClass,
                      day.tradeCount > 0 && "cursor-pointer hover:opacity-80"
                    )}
                    onMouseEnter={(e) => handleMouseEnter(e, day)}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-0.5">
            <div className="h-3 w-3 rounded-sm bg-muted opacity-40" />
            <div className="h-3 w-3 rounded-sm bg-emerald-500/30" />
            <div className="h-3 w-3 rounded-sm bg-emerald-500/60" />
            <div className="h-3 w-3 rounded-sm bg-emerald-500/90" />
          </div>
          <span>More profit</span>
          <span className="ml-2">Less</span>
          <div className="flex gap-0.5">
            <div className="h-3 w-3 rounded-sm bg-red-500/30" />
            <div className="h-3 w-3 rounded-sm bg-red-500/60" />
            <div className="h-3 w-3 rounded-sm bg-red-500/90" />
          </div>
          <span>More loss</span>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <p className="font-medium text-foreground">
              {new Date(tooltip.dayData.date + "T00:00:00Z").toLocaleDateString(
                "en-US",
                {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                },
              )}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {tooltip.dayData.tradeCount}{" "}
              {tooltip.dayData.tradeCount === 1 ? "trade" : "trades"}
            </p>
            <p
              className={cn(
                "font-semibold",
                tooltip.dayData.pnl >= 0 ? "text-emerald-500" : "text-red-400"
              )}
            >
              {tooltip.dayData.pnl >= 0 ? "+" : ""}
              {tooltip.dayData.pnl.toFixed(2)}
            </p>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Best Day
          </p>
          <p className="mt-1 text-base font-bold text-emerald-500">
            {bestDay
              ? `+$${bestDay.pnl.toFixed(2)}`
              : "—"}
          </p>
          {bestDay && (
            <p className="text-[10px] text-muted-foreground">
              {new Date(bestDay.date + "T00:00:00Z").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Worst Day
          </p>
          <p className="mt-1 text-base font-bold text-red-400">
            {worstDay
              ? `${worstDay.pnl >= 0 ? "+" : "-"}$${Math.abs(worstDay.pnl).toFixed(2)}`
              : "—"}
          </p>
          {worstDay && (
            <p className="text-[10px] text-muted-foreground">
              {new Date(worstDay.date + "T00:00:00Z").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Green Days
          </p>
          <p
            className={cn(
              "mt-1 text-base font-bold",
              greenDaysPct >= 50 ? "text-emerald-500" : "text-red-400"
            )}
          >
            {greenDaysPct}%
          </p>
          <p className="text-[10px] text-muted-foreground">
            of trading days
          </p>
        </div>
      </div>
    </div>
  );
}
