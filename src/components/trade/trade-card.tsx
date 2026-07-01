"use client";

import type { Trade } from "@/types/database";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface TradeCardProps {
  readonly trade: Trade;
}

export function TradeCard({ trade }: TradeCardProps) {
  // Use pnl_absolute as the canonical "closed" signal — trades closed via
  // multi-TP results have it set even when exit_price is null.
  const isOpen = trade.pnl_absolute === null;
  const isProfitable =
    trade.pnl_absolute !== null && trade.pnl_absolute >= 0;

  return (
    <Card className="border-border/40 bg-card/50 hover:bg-muted/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {trade.instrument}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold uppercase",
                trade.direction === "buy"
                  ? "border-pos/30 text-pos bg-pos/10"
                  : "border-neg/30 text-neg bg-neg/10",
              )}
            >
              {trade.direction}
            </Badge>
          </div>
          {isOpen ? (
            <Badge
              variant="outline"
              className="text-[10px] border-warn/30 text-warn bg-warn/10"
            >
              Open
            </Badge>
          ) : (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                isProfitable ? "text-pos" : "text-neg",
              )}
            >
              {isProfitable ? "+" : ""}
              {formatCurrency(trade.pnl_absolute!)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Entry</span>
            <p className="tabular-nums font-medium">
              {trade.entry_price.toFixed(trade.entry_price < 10 ? 5 : 2)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Exit</span>
            <p className="tabular-nums font-medium">
              {trade.exit_price !== null
                ? trade.exit_price.toFixed(trade.exit_price < 10 ? 5 : 2)
                : "---"}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          {formatDateTime(trade.entry_time)}
        </p>
      </CardContent>
    </Card>
  );
}
