"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { Trade, TPResult } from "@/types/database";
import { cn, formatDateTime } from "@/lib/utils";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface TradeTableProps {
  readonly trades: readonly Trade[];
}

/**
 * Sort keys. `tps_hit_pct` and `status` are derived client-side but sortable
 * because users asked for them in the mock. `mode` sorts on split_risk.
 */
type SortKey =
  | "entry_time"
  | "instrument"
  | "direction"
  | "order_type"
  | "entry_price"
  | "stop_loss"
  | "tps_hit_pct"
  | "risk_reward_ratio"
  | "pips"
  | "status"
  | "source"
  | "mode";

interface SortState {
  readonly key: SortKey;
  readonly dir: "asc" | "desc";
}

type TradeStatus = "open" | "win" | "loss" | "breakeven" | "partial";

interface TpSummary {
  readonly total: number;
  readonly hit: number;
  readonly pct: number; // 0..1
}

/**
 * Count TPs that are set and count how many have been hit. We treat "be" as
 * 0.5 of a hit for display purposes (it's not a loss, not a full win), but
 * we keep the integer count too so the table shows "2/4" not "2.5/4".
 */
function summarizeTps(trade: Trade): TpSummary {
  const prices: readonly (number | null)[] = [
    trade.tp1,
    trade.tp2,
    trade.tp3,
    trade.tp4,
    trade.tp5,
    trade.tp6,
    trade.tp7,
  ];
  const results: readonly (TPResult | null)[] = [
    trade.tp1_result,
    trade.tp2_result,
    trade.tp3_result,
    trade.tp4_result,
    trade.tp5_result,
    trade.tp6_result,
    trade.tp7_result,
  ];

  let total = 0;
  let hit = 0;
  for (let i = 0; i < prices.length; i += 1) {
    // A TP "counts" if it has a price OR a result (edge: legacy trades with
    // only take_profit set will still show a usable summary via tp1 fallback).
    if (prices[i] != null || results[i] != null) total += 1;
    if (results[i] === "hit") hit += 1;
  }

  // Legacy single-TP fallback: if no tp* prices but take_profit is set.
  if (total === 0 && trade.take_profit != null) {
    total = 1;
    if (trade.exit_price != null && trade.pnl_absolute != null && trade.pnl_absolute > 0) {
      hit = 1;
    }
  }

  const pct = total > 0 ? hit / total : 0;
  return { total, hit, pct };
}

/**
 * Derive the trade status from existing columns. Order matters — we resolve
 * "most specific" first (partial is not just closed, it's closed with mixed
 * TP outcomes).
 */
function deriveStatus(trade: Trade, tps: TpSummary): TradeStatus {
  // Multi-TP path: if any tp*_result is set but exit_price is null, we can
  // still classify without waiting for a single closing exit price.
  const results: readonly (TPResult | null)[] = [
    trade.tp1_result,
    trade.tp2_result,
    trade.tp3_result,
    trade.tp4_result,
    trade.tp5_result,
    trade.tp6_result,
    trade.tp7_result,
  ];
  const anyResult = results.some((r) => r != null);

  if (!anyResult && trade.exit_price === null) return "open";

  // Any loss closes the trade on the losing side of the book.
  const slCount = results.filter((r) => r === "sl").length;
  const hitCount = results.filter((r) => r === "hit").length;
  const beCount = results.filter((r) => r === "be").length;

  if (anyResult) {
    if (hitCount > 0 && slCount > 0) return "partial";
    if (hitCount > 0 && beCount > 0) return "partial";
    if (hitCount === tps.total && tps.total > 0) return "win";
    if (slCount > 0 && hitCount === 0) return "loss";
    if (beCount > 0 && hitCount === 0 && slCount === 0) return "breakeven";
    if (hitCount > 0) return "win";
    if (slCount > 0) return "loss";
    return "open";
  }

  // Legacy exit-price path.
  if (trade.pnl_absolute === null) return "open";
  if (trade.pnl_absolute > 0) return "win";
  if (trade.pnl_absolute < 0) return "loss";
  return "breakeven";
}

interface StatusStyle {
  readonly label: string;
  readonly className: string;
}

function statusStyle(s: TradeStatus): StatusStyle {
  switch (s) {
    case "win":
      return { label: "Win", className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" };
    case "loss":
      return { label: "Loss", className: "border-red-500/30 text-red-400 bg-red-500/10" };
    case "breakeven":
      return { label: "BE", className: "border-amber-500/30 text-amber-400 bg-amber-500/10" };
    case "partial":
      return { label: "Partial", className: "border-sky-500/30 text-sky-400 bg-sky-500/10" };
    case "open":
    default:
      return { label: "Open", className: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10" };
  }
}

function sourceLabel(src: Trade["source"]): string {
  switch (src) {
    case "mt5_webhook":
      return "MT5";
    case "csv":
      return "CSV";
    case "manual":
    default:
      return "Manual";
  }
}

function formatPrice(n: number): string {
  // Use 5 decimals for small-value FX pairs and 2 for everything else.
  return n.toFixed(n < 10 ? 5 : 2);
}

/**
 * Risk-to-reward display. Drops trailing zeros so clean ratios render as
 * `1:3` instead of `1:3.00`, while fractional ratios keep just enough
 * precision to be readable (`1:3.5`, `1:2.75`, `1:1.12`). Matches the client
 * mock — the table should *not* look like a scientific output when the
 * numbers are tidy.
 */
function formatRR(ratio: number): string {
  // Round to 2dp to kill float noise (1.9999999 → 2), then strip zeros.
  const rounded = Math.round(ratio * 100) / 100;
  // toString already drops trailing zeros: 3 → "3", 3.5 → "3.5", 3.52 → "3.52".
  return `1:${rounded}`;
}

/**
 * Realized pips for a closed trade. Null for open trades (no exit). We look
 * up the per-instrument `pipSize` so forex majors, JPY pairs, XAUUSD, indices,
 * and crypto CFDs all use their correct pip convention.
 *
 * Sign convention: positive = trade made money, negative = trade lost money.
 * For a buy, (exit − entry) / pipSize; for a sell, flip the sign.
 */
function computePips(trade: Trade): number | null {
  if (trade.exit_price === null) return null;
  const spec = getInstrumentSpec(trade.instrument);
  if (spec.pipSize <= 0) return null;
  const rawMove = trade.exit_price - trade.entry_price;
  const directional = trade.direction === "buy" ? rawMove : -rawMove;
  return directional / spec.pipSize;
}

function formatPips(n: number): string {
  // Display as integer — pip fractions below 1 aren't useful at the table glance,
  // and larger moves are always whole-pip rounded in broker statements.
  const rounded = Math.round(n);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
}

/**
 * Build a sortable scalar value for each column. Open-trade nulls sort last
 * in descending mode (which is the common user expectation: "show me the
 * biggest wins first, leave open trades to the bottom").
 */
function getSortValue(trade: Trade, key: SortKey): number | string {
  if (key === "entry_time") return trade.entry_time;
  if (key === "instrument") return trade.instrument;
  if (key === "direction") return trade.direction;
  if (key === "order_type") return trade.order_type ?? "market";
  if (key === "entry_price") return trade.entry_price;
  if (key === "stop_loss") return trade.stop_loss ?? -Infinity;
  if (key === "tps_hit_pct") return summarizeTps(trade).pct;
  if (key === "risk_reward_ratio") return trade.risk_reward_ratio ?? -Infinity;
  if (key === "pips") return computePips(trade) ?? -Infinity;
  if (key === "status") return deriveStatus(trade, summarizeTps(trade));
  if (key === "source") return trade.source;
  if (key === "mode") return trade.split_risk ? "split" : "single";
  return "";
}

export function TradeTable({ trades }: TradeTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>({ key: "entry_time", dir: "desc" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      const aVal = getSortValue(a, sort.key);
      const bVal = getSortValue(b, sort.key);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [trades, sort]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error ?? "Failed to delete trade");
          return;
        }
        toast.success("Trade deleted");
        router.refresh();
      } catch {
        toast.error("Failed to delete trade");
      } finally {
        setDeletingId(null);
      }
    },
    [router],
  );

  const SortHeader = useCallback(
    ({ label, sortKey, className }: { label: string; sortKey: SortKey; className?: string }) => (
      <TableHead
        className={cn(
          "cursor-pointer select-none hover:text-foreground transition-colors text-[11px] uppercase tracking-wider",
          className,
        )}
        onClick={() => toggleSort(sortKey)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sort.key === sortKey && (
            <span className="text-xs">{sort.dir === "asc" ? "\u2191" : "\u2193"}</span>
          )}
        </span>
      </TableHead>
    ),
    [sort, toggleSort],
  );

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <svg
            className="h-8 w-8 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-1">No trades yet</h3>
        <p className="text-sm text-muted-foreground">
          Start logging your trades to build your journal.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border/40">
            <SortHeader label="Date" sortKey="entry_time" />
            <SortHeader label="Symbol" sortKey="instrument" />
            <SortHeader label="Dir" sortKey="direction" />
            <SortHeader label="Type" sortKey="order_type" />
            <SortHeader label="Entry" sortKey="entry_price" className="text-right" />
            <SortHeader label="SL" sortKey="stop_loss" className="text-right" />
            <SortHeader label="TPs Hit" sortKey="tps_hit_pct" className="text-right" />
            <SortHeader label="R:R" sortKey="risk_reward_ratio" className="text-right" />
            <SortHeader label="Pips" sortKey="pips" className="text-right" />
            <SortHeader label="Status" sortKey="status" />
            <SortHeader label="Source" sortKey="source" />
            <SortHeader label="Mode" sortKey="mode" />
            <TableHead className="text-right text-[11px] uppercase tracking-wider">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((trade) => {
            const tps = summarizeTps(trade);
            const status = deriveStatus(trade, tps);
            const style = statusStyle(status);
            const pips = computePips(trade);
            const isOpen = status === "open";
            const mode = trade.split_risk ? "Split" : "Single";

            return (
              <TableRow
                key={trade.id}
                className="cursor-pointer border-border/40 hover:bg-muted/50 transition-colors"
                onClick={() => router.push(`/journal/${trade.id}`)}
              >
                <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDateTime(trade.entry_time)}
                </TableCell>
                <TableCell className="font-medium">{trade.instrument}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-semibold uppercase",
                      trade.direction === "buy"
                        ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                        : "border-red-500/30 text-red-400 bg-red-500/10",
                    )}
                  >
                    {trade.direction}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground tracking-wider">
                  {trade.order_type ?? "market"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPrice(trade.entry_price)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {trade.stop_loss !== null ? formatPrice(trade.stop_loss) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {tps.total > 0 ? (
                    <span
                      className={cn(
                        "text-sm font-medium",
                        tps.hit === tps.total && tps.total > 0
                          ? "text-emerald-400"
                          : tps.hit > 0
                            ? "text-sky-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {tps.hit}/{tps.total}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {trade.risk_reward_ratio !== null
                    ? formatRR(trade.risk_reward_ratio)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {isOpen || pips === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        pips >= 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {formatPips(pips)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("text-xs", style.className)}>
                    {style.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground uppercase tracking-wider">
                  {sourceLabel(trade.source)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {mode}
                </TableCell>
                <TableCell className="text-right">
                  <div
                    className="flex justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => router.push(`/journal/${trade.id}/edit`)}
                    >
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          />
                        }
                      >
                        Delete
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete trade?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete your{" "}
                            {trade.instrument} {trade.direction.toUpperCase()}{" "}
                            trade. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deletingId === trade.id}
                            onClick={() => handleDelete(trade.id)}
                          >
                            {deletingId === trade.id ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
