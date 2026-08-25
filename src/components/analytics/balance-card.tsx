"use client";

import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import {
  computeCurrentBalance,
  realizedPnl,
  riskBaseBalance,
} from "@/lib/trades/balance";
import type { AccountCurrency, RiskBasis, Trade } from "@/types/database";

interface BalanceCardProps {
  readonly trades: readonly Trade[];
  readonly startingCapital: number | null | undefined;
  readonly currency?: AccountCurrency;
  readonly riskPercent?: number | null;
  readonly riskBasis?: RiskBasis;
}

/**
 * Account balance — the journal's capital as it stands now.
 *
 * Renders nothing when no capital is configured: an account figure with no
 * account behind it would be a made-up number.
 */
export function BalanceCard({
  trades,
  startingCapital,
  currency = "USD",
  riskPercent,
  riskBasis = "compounding",
}: BalanceCardProps) {
  const balance = computeCurrentBalance(startingCapital, trades);
  if (balance === null || startingCapital == null) return null;

  // `pnl_absolute` is converted to USD (see lib/trading/quote-conversion), while
  // `initial_capital` is typed in the journal's own currency. Adding the two is
  // only valid when they're the same currency — for a EUR journal the sum would
  // be part-euro, part-dollar and labelled "EUR", i.e. a number the broker would
  // disagree with. Say so instead of inventing it.
  if (currency !== "USD") {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Account Balance
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {`Unavailable for ${currency} journals: trade P&L is calculated in USD, so it can't be added to a ${currency} capital figure. Set the journal's account currency to USD to track a running balance.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  const netReturn = realizedPnl(trades);
  const returnPercent = (netReturn / startingCapital) * 100;
  const up = netReturn > 0;
  const flat = netReturn === 0;

  // What the next trade will risk — the compounding effect made concrete. This
  // MUST go through the same helper the trade form sizes with, or the two
  // surfaces quote different money for the same next trade.
  const { base: riskBase, depleted } = riskBaseBalance({
    startingCapital,
    currentBalance: balance,
    basis: riskBasis,
  });
  const nextRisk =
    !depleted && riskBase !== null && riskPercent != null && riskPercent > 0
      ? (riskBase * riskPercent) / 100
      : null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border bg-card bg-gradient-to-br",
        flat
          ? "from-muted/40 to-transparent"
          : up
            ? "from-pos/10 to-transparent"
            : "from-neg/10 to-transparent",
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Account Balance
          </p>
          <div
            className={cn(
              "rounded-lg p-2",
              flat ? "bg-muted" : up ? "bg-pos/15" : "bg-neg/15",
            )}
          >
            <Wallet
              className={cn(
                "h-4 w-4",
                flat ? "text-muted-foreground" : up ? "text-pos" : "text-neg",
              )}
            />
          </div>
        </div>

        <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-foreground">
          {formatCurrency(balance, currency)}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {currency} {startingCapital.toLocaleString("en-US")} start
          {" · "}
          <span
            className={cn(
              "font-medium",
              flat ? "text-muted-foreground" : up ? "text-pos" : "text-neg",
            )}
          >
            {netReturn > 0 ? "+" : ""}
            {formatCurrency(netReturn, currency)} ({returnPercent > 0 ? "+" : ""}
            {returnPercent.toFixed(2)}%)
          </span>
        </p>

        {depleted ? (
          <p className="mt-1 text-xs font-medium text-neg">
            Account is at or below zero — position sizing paused.
          </p>
        ) : (
          nextRisk !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next trade risks {riskPercent}% ={" "}
              <span className="font-medium text-foreground">
                {formatCurrency(nextRisk, currency)}
              </span>
              {riskBasis === "compounding" && netReturn !== 0 && (
                <span className="text-[10px]"> (compounding)</span>
              )}
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
