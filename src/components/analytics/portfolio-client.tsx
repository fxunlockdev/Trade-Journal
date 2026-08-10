"use client";

import { useMemo, useState } from "react";
import { Layers } from "lucide-react";

import type { JournalWithRole, Trade } from "@/types/database";
import { cn, formatCurrency } from "@/lib/utils";
import {
  computeProfitFactor,
  computeTotalPnl,
  computeWinRate,
} from "@/lib/trades/analytics";
import { computeTotalPips } from "@/lib/trades/pips";
import { COLOR_CLASS } from "@/components/journals/journal-switcher";
import { StatsCards } from "@/components/analytics/stats-cards";
import { EquityCurve } from "@/components/analytics/equity-curve";
import { WinLossPie } from "@/components/analytics/win-loss-pie";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PortfolioClientProps {
  readonly journals: readonly JournalWithRole[];
  readonly trades: readonly Trade[];
}

/** Closed = has a finite P&L, matching every other analytics surface. */
function isClosed(t: Trade): boolean {
  return t.pnl_absolute !== null && Number.isFinite(t.pnl_absolute);
}

interface GroupStats {
  readonly key: string;
  readonly label: string;
  readonly trades: number;
  readonly closed: number;
  readonly pnl: number;
  readonly winRate: number;
  readonly pips: number;
  readonly profitFactor: number | null;
}

function summarize(
  key: string,
  label: string,
  rows: readonly Trade[],
): GroupStats {
  const closed = rows.filter(isClosed);
  return {
    key,
    label,
    trades: rows.length,
    closed: closed.length,
    pnl: computeTotalPnl(rows),
    winRate: computeWinRate(rows),
    pips: computeTotalPips(rows),
    profitFactor: computeProfitFactor(rows),
  };
}

function PnlCell({ value }: { readonly value: number }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-muted-foreground",
      )}
    >
      {value > 0 ? "+" : ""}
      {formatCurrency(value)}
    </span>
  );
}

/**
 * Toggle chips. Nothing selected means "everything" — a filter you can't
 * accidentally empty into a blank screen.
 */
function FilterChips({
  options,
  selected,
  onToggle,
  onAll,
  renderDot,
}: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (value: string) => void;
  readonly onAll: () => void;
  readonly renderDot?: (value: string) => string | null;
}) {
  const allActive = selected.size === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onAll}
        className={cn(
          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
          allActive
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {options.map((o) => {
        const active = allActive || selected.has(o.value);
        const dot = renderDot?.(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selected.has(o.value)
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
              allActive && !selected.has(o.value) && "opacity-70",
            )}
            aria-pressed={active}
          >
            {dot && <span className={cn("size-2 rounded-full", dot)} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PortfolioClient({ journals, trades }: PortfolioClientProps) {
  const [journalSel, setJournalSel] = useState<ReadonlySet<string>>(new Set());
  const [instrumentSel, setInstrumentSel] = useState<ReadonlySet<string>>(new Set());

  const journalName = useMemo(() => {
    const map = new Map<string, JournalWithRole>();
    for (const j of journals) map.set(j.id, j);
    return map;
  }, [journals]);

  // Instrument options come from the journals currently in scope, so picking
  // "Yohan + Chris" narrows the asset list to what those two actually traded.
  const journalScoped = useMemo(
    () =>
      journalSel.size === 0
        ? trades
        : trades.filter((t) => journalSel.has(t.journal_id)),
    [trades, journalSel],
  );

  const instrumentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of journalScoped) set.add(t.instrument);
    return [...set]
      .sort()
      .map((i) => ({ value: i, label: i }));
  }, [journalScoped]);

  const filtered = useMemo(
    () =>
      instrumentSel.size === 0
        ? journalScoped
        : journalScoped.filter((t) => instrumentSel.has(t.instrument)),
    [journalScoped, instrumentSel],
  );

  const byJournal = useMemo(() => {
    const groups = new Map<string, Trade[]>();
    for (const t of filtered) {
      const list = groups.get(t.journal_id);
      if (list) list.push(t);
      else groups.set(t.journal_id, [t]);
    }
    return [...groups.entries()]
      .map(([id, rows]) =>
        summarize(id, journalName.get(id)?.name ?? "Unknown journal", rows),
      )
      .sort((a, b) => b.pnl - a.pnl);
  }, [filtered, journalName]);

  const byInstrument = useMemo(() => {
    const groups = new Map<string, Trade[]>();
    for (const t of filtered) {
      const list = groups.get(t.instrument);
      if (list) list.push(t);
      else groups.set(t.instrument, [t]);
    }
    return [...groups.entries()]
      .map(([sym, rows]) => summarize(sym, sym, rows))
      .sort((a, b) => b.pnl - a.pnl);
  }, [filtered]);

  const toggle = (
    set: ReadonlySet<string>,
    apply: (next: ReadonlySet<string>) => void,
    value: string,
  ): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const scopeLabel =
    journalSel.size === 0
      ? `all ${journals.length} journal${journals.length === 1 ? "" : "s"}`
      : [...journalSel].map((id) => journalName.get(id)?.name ?? "?").join(" + ");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Layers className="size-5 text-primary" />
          Portfolio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every journal you belong to, combined. Pick journals and assets to see
          them as one book — e.g. two traders&apos; journals on Gold alone.
        </p>
      </div>

      {journals.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              You don&apos;t belong to any journals yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <Card className="border-border bg-card">
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Journals
                </p>
                <FilterChips
                  options={journals.map((j) => ({ value: j.id, label: j.name }))}
                  selected={journalSel}
                  onToggle={(v) => toggle(journalSel, setJournalSel, v)}
                  onAll={() => setJournalSel(new Set())}
                  renderDot={(id) => {
                    const j = journalName.get(id);
                    return j ? COLOR_CLASS[j.color] : null;
                  }}
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assets
                </p>
                {instrumentOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No trades in the selected journals yet.
                  </p>
                ) : (
                  <FilterChips
                    options={instrumentOptions}
                    selected={instrumentSel}
                    onToggle={(v) => toggle(instrumentSel, setInstrumentSel, v)}
                    onAll={() => setInstrumentSel(new Set())}
                  />
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {filtered.length} trade{filtered.length === 1 ? "" : "s"}
                </span>{" "}
                across {scopeLabel}
                {instrumentSel.size > 0 && (
                  <> on {[...instrumentSel].join(", ")}</>
                )}
                .
              </p>
            </CardContent>
          </Card>

          <StatsCards trades={filtered} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="border-border bg-card lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Combined Equity Curve
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EquityCurve trades={filtered} />
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Win / Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                <WinLossPie trades={filtered} />
              </CardContent>
            </Card>
          </div>

          <BreakdownTable
            title="By journal"
            rows={byJournal}
            firstHeader="Journal"
            renderDot={(key) => {
              const j = journalName.get(key);
              return j ? COLOR_CLASS[j.color] : null;
            }}
          />
          <BreakdownTable
            title="By asset"
            rows={byInstrument}
            firstHeader="Asset"
          />
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  firstHeader,
  renderDot,
}: {
  readonly title: string;
  readonly rows: readonly GroupStats[];
  readonly firstHeader: string;
  readonly renderDot?: (key: string) => string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px] uppercase tracking-wider">
                {firstHeader}
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider">
                Trades
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider">
                Net P&amp;L
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider">
                Win rate
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider">
                Pips
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider">
                Profit factor
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className="border-border/40">
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {renderDot?.(r.key) && (
                      <span className={cn("size-2 rounded-full", renderDot(r.key)!)} />
                    )}
                    {r.label}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.closed}
                  {r.trades !== r.closed && (
                    <span className="text-xs"> / {r.trades}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <PnlCell value={r.pnl} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.closed > 0 ? `${r.winRate.toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    r.pips > 0 ? "text-pos" : r.pips < 0 ? "text-neg" : "text-muted-foreground",
                  )}
                >
                  {r.pips > 0 ? "+" : ""}
                  {Math.round(r.pips).toLocaleString("en-US")}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.profitFactor === null ? (
                    <Badge variant="outline" className="text-xs">
                      n/a
                    </Badge>
                  ) : (
                    r.profitFactor.toFixed(2)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
