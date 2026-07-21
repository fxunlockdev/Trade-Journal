import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { computeRiskRewardRatio } from "@/lib/trades/computations";
import type { Trade, TPResult } from "@/types/database";

/**
 * Pips — single source of truth for the per-trade PIPS column AND the
 * period "Total Pips" stat, so a row's pips and the total can never drift
 * apart (they call the same function).
 *
 * "Pips" here is the directional price move of a CLOSED trade, scaled by the
 * instrument's pip size. It is null for open trades and for instruments with
 * no known pip size (we can't scale those).
 */

/**
 * Highest TP price that has result="hit", scanning TP7→TP1 (so the first match
 * is the highest level actually reached). Null when no TP was hit — i.e. SL,
 * break-even, open, or a legacy trade with no per-TP results.
 */
export function highestHitTpPrice(trade: Trade): number | null {
  const tpPairs: ReadonlyArray<{
    readonly result: TPResult | null;
    readonly price: number | null;
  }> = [
    { result: trade.tp7_result, price: trade.tp7 },
    { result: trade.tp6_result, price: trade.tp6 },
    { result: trade.tp5_result, price: trade.tp5 },
    { result: trade.tp4_result, price: trade.tp4 },
    { result: trade.tp3_result, price: trade.tp3 },
    { result: trade.tp2_result, price: trade.tp2 },
    { result: trade.tp1_result, price: trade.tp1 },
  ];
  for (const tp of tpPairs) {
    if (tp.result === "hit" && tp.price != null && tp.price > 0) {
      return tp.price;
    }
  }
  return null;
}

/**
 * Realized pips for a single trade.
 *
 * Measures to the ACTUAL exit_price — for multi-TP trades this is the
 * quantity-weighted realized close that `computeTradeFields` persists, so pips
 * always agree in sign and magnitude with the stored P&L. (Measuring to the
 * highest hit TP instead would over-report a partial win and could even show
 * POSITIVE pips on a net-losing partial where later slices were stopped out.)
 * The highest hit TP is only a fallback for the rare case of a hit with no
 * recorded exit. Open trades (no reference) return null.
 *
 * Direction-aware: a profitable move is always positive regardless of buy/sell.
 */
export function computeTradePips(trade: Trade): number | null {
  const spec = getInstrumentSpec(trade.instrument);
  if (spec.pipSize <= 0) return null;

  const reference = trade.exit_price ?? highestHitTpPrice(trade);
  if (reference === null) return null; // open trade — nothing realized yet

  const rawMove = reference - trade.entry_price;
  const directional = trade.direction === "buy" ? rawMove : -rawMove;
  return directional / spec.pipSize;
}

/**
 * Net pips across a set of trades (open trades and unknown-pip instruments are
 * skipped). Same per-trade basis as the table's PIPS column, so the total is
 * exactly the sum of the rows the user sees.
 */
export function computeTotalPips(trades: readonly Trade[]): number {
  let total = 0;
  for (const trade of trades) {
    const pips = computeTradePips(trade);
    if (pips !== null) total += pips;
  }
  return total;
}

/**
 * Display R:R — the single source of truth for BOTH the table's R:R column and
 * the period "Avg R:R" stat, so they can't disagree. Recomputes from the
 * highest hit TP (correcting legacy rows whose stored risk_reward_ratio used
 * TP1 only), falling back to the stored value when there's no SL/TP to compute
 * from.
 */
export function computeDisplayRR(trade: Trade): number | null {
  const refTp = highestHitTpPrice(trade) ?? trade.tp1 ?? trade.take_profit ?? null;
  if (trade.stop_loss !== null && refTp !== null) {
    return computeRiskRewardRatio(
      trade.entry_price,
      trade.stop_loss,
      refTp,
      trade.direction,
    );
  }
  return trade.risk_reward_ratio;
}
