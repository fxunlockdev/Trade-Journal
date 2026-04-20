import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Trade, TPResult } from "@/types/database";
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

/**
 * Per-TP palette — must stay in sync with `src/components/trade/trade-form.tsx`
 * and `src/components/trade/trade-table.tsx`. TP1..4 match the original mock
 * and TP5..7 extend with distinct but readable accent colors so 7 simultaneous
 * targets remain legible.
 */
interface TpSlot {
  readonly key:
    | "tp1"
    | "tp2"
    | "tp3"
    | "tp4"
    | "tp5"
    | "tp6"
    | "tp7";
  readonly pipsKey:
    | "tp1_pips"
    | "tp2_pips"
    | "tp3_pips"
    | "tp4_pips"
    | "tp5_pips"
    | "tp6_pips"
    | "tp7_pips";
  readonly resultKey:
    | "tp1_result"
    | "tp2_result"
    | "tp3_result"
    | "tp4_result"
    | "tp5_result"
    | "tp6_result"
    | "tp7_result";
  readonly label: string;
  readonly accent: string;
  readonly badge: string;
}

const TP_SLOTS: readonly TpSlot[] = [
  { key: "tp1", pipsKey: "tp1_pips", resultKey: "tp1_result", label: "TP1", accent: "border-emerald-500/60 bg-emerald-500/5", badge: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" },
  { key: "tp2", pipsKey: "tp2_pips", resultKey: "tp2_result", label: "TP2", accent: "border-sky-500/60 bg-sky-500/5", badge: "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30" },
  { key: "tp3", pipsKey: "tp3_pips", resultKey: "tp3_result", label: "TP3", accent: "border-violet-500/60 bg-violet-500/5", badge: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30" },
  { key: "tp4", pipsKey: "tp4_pips", resultKey: "tp4_result", label: "TP4", accent: "border-orange-500/60 bg-orange-500/5", badge: "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30" },
  { key: "tp5", pipsKey: "tp5_pips", resultKey: "tp5_result", label: "TP5", accent: "border-cyan-500/60 bg-cyan-500/5", badge: "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/30" },
  { key: "tp6", pipsKey: "tp6_pips", resultKey: "tp6_result", label: "TP6", accent: "border-rose-500/60 bg-rose-500/5", badge: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30" },
  { key: "tp7", pipsKey: "tp7_pips", resultKey: "tp7_result", label: "TP7", accent: "border-lime-500/60 bg-lime-500/5", badge: "bg-lime-500/15 text-lime-400 ring-1 ring-lime-500/30" },
] as const;

const TP_RESULT_LABEL: Readonly<Record<TPResult, string>> = {
  hit: "Hit",
  be: "BE",
  sl: "SL",
};

function tpResultStyle(result: TPResult): string {
  if (result === "hit")
    return "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30";
  if (result === "sl") return "bg-red-500/15 text-red-400 ring-1 ring-red-500/30";
  return "bg-muted text-muted-foreground ring-1 ring-border/40";
}

function formatTpPrice(value: number): string {
  return value.toFixed(value < 10 ? 5 : 2);
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

  // Compute which TP slots have any data (price, pips, or result). Falling
  // back to the legacy `take_profit` is only relevant when tp1 is null — all
  // write paths (POST /api/trades, PATCH, chat) sync `take_profit → tp1`,
  // so legacy rows from before the 7-TP refactor still render correctly.
  const activeTpSlots = TP_SLOTS.filter((slot) => {
    const price = t[slot.key];
    const pips = t[slot.pipsKey];
    const result = t[slot.resultKey];
    return price !== null || pips !== null || result !== null;
  });
  const hasNoStructuredTps = activeTpSlots.length === 0;
  const legacyTpOnly = hasNoStructuredTps && t.take_profit !== null;

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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Entry</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatTpPrice(t.entry_price)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Exit</p>
                <p className="text-lg font-semibold tabular-nums">
                  {t.exit_price !== null ? formatTpPrice(t.exit_price) : "---"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Stop Loss</p>
                <p className="text-lg font-semibold tabular-nums text-red-400">
                  {t.stop_loss !== null ? formatTpPrice(t.stop_loss) : "---"}
                  {t.sl_pips !== null && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      ({t.sl_pips} pips)
                    </span>
                  )}
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
      </div>

      {/* Take Profits — full width so up to 7 slots fit comfortably. */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Take Profits
          </CardTitle>
          {t.split_risk && (
            <Badge
              variant="outline"
              className="text-xs border-border/40 text-muted-foreground"
            >
              Split risk · {t.num_positions} positions
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {legacyTpOnly && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-xs text-muted-foreground mb-1">
                Take Profit (legacy)
              </p>
              <p className="text-lg font-semibold tabular-nums text-emerald-400">
                {formatTpPrice(t.take_profit as number)}
              </p>
            </div>
          )}
          {!legacyTpOnly && hasNoStructuredTps && (
            <p className="text-sm text-muted-foreground italic">
              No take profits set on this trade.
            </p>
          )}
          {activeTpSlots.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {activeTpSlots.map((slot) => {
                const price = t[slot.key];
                const pips = t[slot.pipsKey];
                const result = t[slot.resultKey];
                const isTp4Trailing = slot.key === "tp4" && t.tp4_trailing;
                return (
                  <div
                    key={slot.key}
                    className={cn(
                      "rounded-md border p-3 space-y-2",
                      slot.accent,
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-xs font-semibold tracking-wide",
                          slot.badge,
                        )}
                      >
                        {slot.label}
                      </span>
                      {result !== null && (
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
                            tpResultStyle(result),
                          )}
                        >
                          {TP_RESULT_LABEL[result]}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {price !== null ? formatTpPrice(price) : "---"}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {pips !== null && <span>{pips} pips</span>}
                      {isTp4Trailing && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30 font-semibold uppercase">
                          Trailing
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
