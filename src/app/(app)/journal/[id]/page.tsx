import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Trade } from "@/types/database";
import {
  cn,
  formatCurrency,
  formatPercentage,
  formatDateTime,
} from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TradeDeleteButton } from "./trade-delete-button";

interface TradeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TradeDetailPage({ params }: TradeDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: trade } = await supabase
    .from("trades")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!trade) {
    notFound();
  }

  const t = trade as Trade;
  const isOpen = t.exit_price === null;
  const isProfitable = t.pnl_absolute !== null && t.pnl_absolute >= 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/journal"
            className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            &larr; Journal
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {t.instrument}
            </h1>
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-semibold uppercase",
                t.direction === "buy"
                  ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                  : "border-red-500/30 text-red-400 bg-red-500/10",
              )}
            >
              {t.direction}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                isOpen
                  ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10"
                  : "border-border/40 text-muted-foreground",
              )}
            >
              {isOpen ? "Open" : "Closed"}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/journal/${t.id}/edit`}
            className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
          >
            Edit
          </Link>
          <TradeDeleteButton tradeId={t.id} instrument={t.instrument} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Price Grid */}
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Prices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Entry</p>
                <p className="text-lg font-semibold tabular-nums">
                  {t.entry_price.toFixed(t.entry_price < 10 ? 5 : 2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Exit</p>
                <p className="text-lg font-semibold tabular-nums">
                  {t.exit_price !== null
                    ? t.exit_price.toFixed(t.exit_price < 10 ? 5 : 2)
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Stop Loss</p>
                <p className="text-lg font-semibold tabular-nums text-red-400">
                  {t.stop_loss !== null
                    ? t.stop_loss.toFixed(t.stop_loss < 10 ? 5 : 2)
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Take Profit</p>
                <p className="text-lg font-semibold tabular-nums text-emerald-400">
                  {t.take_profit !== null
                    ? t.take_profit.toFixed(t.take_profit < 10 ? 5 : 2)
                    : "---"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Performance */}
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">P&L</p>
                <p
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    t.pnl_absolute === null
                      ? "text-muted-foreground"
                      : isProfitable
                        ? "text-emerald-400"
                        : "text-red-400",
                  )}
                >
                  {t.pnl_absolute !== null
                    ? `${isProfitable ? "+" : ""}${formatCurrency(t.pnl_absolute)}`
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">P&L %</p>
                <p
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    t.pnl_percentage === null
                      ? "text-muted-foreground"
                      : t.pnl_percentage >= 0
                        ? "text-emerald-400"
                        : "text-red-400",
                  )}
                >
                  {t.pnl_percentage !== null
                    ? `${t.pnl_percentage >= 0 ? "+" : ""}${formatPercentage(t.pnl_percentage)}`
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">R:R Ratio</p>
                <p className="text-xl font-bold tabular-nums text-foreground">
                  {t.risk_reward_ratio !== null
                    ? `1:${t.risk_reward_ratio.toFixed(2)}`
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">R-Multiple</p>
                <p
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    t.r_multiple === null
                      ? "text-muted-foreground"
                      : t.r_multiple >= 0
                        ? "text-emerald-400"
                        : "text-red-400",
                  )}
                >
                  {t.r_multiple !== null
                    ? `${t.r_multiple >= 0 ? "+" : ""}${t.r_multiple.toFixed(2)}R`
                    : "---"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Meta */}
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Quantity</p>
                <p className="font-medium tabular-nums">{t.quantity}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Lot Size</p>
                <p className="font-medium tabular-nums">
                  {t.lot_size ?? "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Fees</p>
                <p className="font-medium tabular-nums">
                  {formatCurrency(t.fees)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Source</p>
                <Badge variant="secondary" className="text-xs capitalize">
                  {t.source}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Entry Time</p>
                <p className="font-medium">{formatDateTime(t.entry_time)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Exit Time</p>
                <p className="font-medium">
                  {t.exit_time ? formatDateTime(t.exit_time) : "---"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes & Tags */}
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Notes & Tags
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {t.notes ? (
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {t.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No notes recorded.
              </p>
            )}

            {t.tags.length > 0 && (
              <>
                <Separator className="border-border/40" />
                <div className="flex gap-2 flex-wrap">
                  {t.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
