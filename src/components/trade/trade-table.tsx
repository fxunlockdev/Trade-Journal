"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { Trade } from "@/types/database";
import { cn, formatCurrency, formatPercentage, formatDateTime } from "@/lib/utils";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TradeTableProps {
  readonly trades: readonly Trade[];
}

type SortKey =
  | "entry_time"
  | "instrument"
  | "direction"
  | "entry_price"
  | "exit_price"
  | "pnl_absolute"
  | "risk_reward_ratio";

interface SortState {
  readonly key: SortKey;
  readonly dir: "asc" | "desc";
}

function getSortValue(trade: Trade, key: SortKey): number | string {
  const val = trade[key];
  if (val === null || val === undefined) return key === "instrument" || key === "direction" ? "" : -Infinity;
  return val;
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
    ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
      <TableHead
        className="cursor-pointer select-none hover:text-foreground transition-colors"
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
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border/40">
            <SortHeader label="Date" sortKey="entry_time" />
            <SortHeader label="Instrument" sortKey="instrument" />
            <SortHeader label="Direction" sortKey="direction" />
            <SortHeader label="Entry" sortKey="entry_price" />
            <TableHead>Exit</TableHead>
            <SortHeader label="P&L" sortKey="pnl_absolute" />
            <SortHeader label="R:R" sortKey="risk_reward_ratio" />
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((trade) => {
            const isProfitable =
              trade.pnl_absolute !== null && trade.pnl_absolute >= 0;
            const isOpen = trade.exit_price === null;

            return (
              <TableRow
                key={trade.id}
                className="cursor-pointer border-border/40 hover:bg-muted/50 transition-colors"
                onClick={() => router.push(`/journal/${trade.id}`)}
              >
                <TableCell className="text-sm tabular-nums text-muted-foreground">
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
                <TableCell className="tabular-nums">
                  {trade.entry_price.toFixed(trade.entry_price < 10 ? 5 : 2)}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {trade.exit_price !== null
                    ? trade.exit_price.toFixed(trade.exit_price < 10 ? 5 : 2)
                    : "---"}
                </TableCell>
                <TableCell>
                  {isOpen ? (
                    <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-400 bg-yellow-500/10">
                      Open
                    </Badge>
                  ) : (
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        isProfitable ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {isProfitable ? "+" : ""}
                      {formatCurrency(trade.pnl_absolute!)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {trade.risk_reward_ratio !== null
                    ? `1:${trade.risk_reward_ratio.toFixed(1)}`
                    : "---"}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {trade.tags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {trade.tags.length > 3 && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0" />
                          }
                        >
                          +{trade.tags.length - 3}
                        </TooltipTrigger>
                        <TooltipContent>
                          {trade.tags.slice(3).join(", ")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
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
