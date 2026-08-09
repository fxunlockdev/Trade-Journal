import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import {
  computeRiskRewardRatio,
  furthestHitTpPrice,
} from "@/lib/trades/computations";
import type { Trade } from "@/types/database";

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
 * Furthest TP marked "hit" — the level the trade actually reached. Re-exported
 * from the computations module so the exit price, the R-multiple and the R:R
 * shown in the table all resolve the same way. Null when nothing was hit.
 */
export const highestHitTpPrice = furthestHitTpPrice<Trade>;

/**
 * Realized pips for a single trade.
 *
 * Measures to the STORED `exit_price` — the one number every other surface
 * (P&L, equity curve, calendar, analytics) is derived from, so pips can never
 * contradict the money shown beside them. `computeTradeFields` writes that exit
 * from the TP results on save (furthest level reached for a single position,
 * quantity-weighted close for a split), and broker rows store the real fill.
 * The highest hit TP is only a fallback for a hit with no recorded exit.
 * Open trades (no reference) return null.
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
