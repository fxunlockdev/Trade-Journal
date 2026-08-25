import { computeLotSize } from "@/lib/trading/lot-size";
import type { AccountCurrency, TradeDirection } from "@/types/database";

/**
 * Derive a position size from the JOURNAL's account capital instead of making
 * the trader type a quantity on every trade.
 *
 * Risk-based sizing: you risk a fixed % of the account, so the position size
 * falls out of the stop distance — a tight stop buys a bigger position, a wide
 * stop a smaller one, and the money at risk stays constant. That is what makes
 * the resulting P&L comparable across trades.
 *
 * Deliberately a thin wrapper over `computeLotSize`, the same function behind
 * the Lot Size Calculator page. One implementation of the sizing math, so the
 * calculator and the trade form can never disagree.
 */

export interface AutoSizeInput {
  /** Journal account size. Null/absent turns auto-sizing off. */
  readonly capital: number | null | undefined;
  readonly accountCurrency: AccountCurrency;
  /** Percent of capital to risk on this trade. */
  readonly riskPercent: number;
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entryPrice: number;
  readonly stopLossPrice: number | null;
}

export interface AutoSizeResult {
  /** Units to store in `trades.quantity`. */
  readonly quantity: number;
  /** Standard lots to store in `trades.lot_size`. */
  readonly lots: number;
  /** Money at risk in account currency — what the user is actually betting. */
  readonly riskAmount: number;
  readonly pipsAtRisk: number;
  /** The balance the risk was taken from — the live one when compounding. */
  readonly basisBalance: number;
  /** Non-blocking notes (e.g. a cross-pair rate approximation). */
  readonly notes: readonly string[];
}

/**
 * Returns null when sizing isn't possible — no capital configured, no stop
 * loss, or a stop on the wrong side of entry. Callers fall back to a
 * hand-entered quantity in that case; auto-sizing never blocks logging a trade.
 */
export function computeAutoSize(input: AutoSizeInput): AutoSizeResult | null {
  const { capital, riskPercent, entryPrice, stopLossPrice } = input;

  if (capital == null || !Number.isFinite(capital) || capital <= 0) return null;
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (stopLossPrice == null || !Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    return null; // risk-based sizing is meaningless without a stop
  }

  const result = computeLotSize({
    accountBalance: capital,
    accountCurrency: input.accountCurrency,
    riskPercent,
    instrument: input.instrument,
    direction: input.direction,
    entryPrice,
    stopLossPrice,
    // Sizing depends only on the stop distance; the reward leg is required by
    // the calculator's input shape but doesn't affect `units`.
    rewardRatio: 1,
  });

  if (result === null) return null;
  if (!Number.isFinite(result.units) || result.units <= 0) return null;

  return {
    quantity: result.units,
    lots: result.standardLots,
    riskAmount: result.dollarRisk,
    pipsAtRisk: result.pipsAtRisk,
    basisBalance: capital,
    // Only surface notes the trader can act on; the >2% risk nag belongs to
    // the calculator page, not to every trade they log.
    notes: result.warnings
      .filter((w) => w.level === "info")
      .map((w) => w.message),
  };
}
