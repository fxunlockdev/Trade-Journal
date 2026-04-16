"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { getStatusColor } from "@/lib/constants/signal-status";
import type { Signal } from "@/types/database";
import { TrendingUp, TrendingDown } from "lucide-react";

interface SignalCardProps {
  readonly signal: Signal;
  readonly onClick?: () => void;
}

function formatPrice(price: number): string {
  return price.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

export function SignalCard({ signal, onClick }: SignalCardProps) {
  const isBuy = signal.direction === "buy";

  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-pointer border-zinc-800 bg-zinc-950 transition-all hover:border-zinc-700 hover:bg-zinc-900/50",
        onClick && "active:scale-[0.99]",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                isBuy ? "bg-emerald-500/10" : "bg-red-500/10",
              )}
            >
              {isBuy ? (
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-400" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100">
                {signal.instrument}
              </h3>
              <p className="text-xs text-zinc-500">
                {formatDate(signal.created_at)}
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              getStatusColor(signal.status),
              "border-zinc-700",
            )}
          >
            {signal.status.replace("_", " ")}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-zinc-500">Entry</p>
            <p className="font-mono text-sm text-zinc-200">
              {formatPrice(signal.entry_price)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">SL</p>
            <p className="font-mono text-sm text-red-400">
              {formatPrice(signal.stop_loss)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">TP1</p>
            <p className="font-mono text-sm text-emerald-400">
              {signal.tp1 !== null ? formatPrice(signal.tp1) : "-"}
            </p>
          </div>
        </div>

        {signal.pips_to_sl !== null && (
          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="text-zinc-500">
              Risk:{" "}
              <span className="font-mono text-red-400">
                {signal.pips_to_sl.toFixed(1)} pips
              </span>
            </span>
            {signal.pips_to_tp1 !== null && (
              <span className="text-zinc-500">
                Reward:{" "}
                <span className="font-mono text-emerald-400">
                  {signal.pips_to_tp1.toFixed(1)} pips
                </span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
