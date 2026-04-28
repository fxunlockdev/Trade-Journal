import type { TradeDirection, TPResult } from "@/types/database";

interface TradeForComputation {
  readonly entry_price: number;
  readonly exit_price: number | null;
  readonly quantity: number;
  readonly direction: TradeDirection;
  readonly fees: number;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;
  // Multi-TP (optional — when provided, weighted PnL replaces single-TP math).
  readonly tp1?: number | null;
  readonly tp2?: number | null;
  readonly tp3?: number | null;
  readonly tp4?: number | null;
  readonly tp5?: number | null;
  readonly tp6?: number | null;
  readonly tp7?: number | null;
  readonly tp1_result?: TPResult | null;
  readonly tp2_result?: TPResult | null;
  readonly tp3_result?: TPResult | null;
  readonly tp4_result?: TPResult | null;
  readonly tp5_result?: TPResult | null;
  readonly tp6_result?: TPResult | null;
  readonly tp7_result?: TPResult | null;
  readonly num_positions?: number | null;
  readonly split_risk?: boolean | null;
}

export function computePnlAbsolute(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  direction: TradeDirection,
  fees: number,
): number {
  const rawPnl =
    direction === "buy"
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
  return rawPnl - fees;
}

export function computePnlPercentage(
  entryPrice: number,
  exitPrice: number,
  direction: TradeDirection,
): number {
  if (entryPrice === 0) return 0;
  return direction === "buy"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
}

export function computeRiskRewardRatio(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  direction: TradeDirection,
): number {
  const risk =
    direction === "buy"
      ? Math.abs(entryPrice - stopLoss)
      : Math.abs(stopLoss - entryPrice);

  if (risk === 0) return 0;

  const reward =
    direction === "buy"
      ? Math.abs(takeProfit - entryPrice)
      : Math.abs(entryPrice - takeProfit);

  return reward / risk;
}

export function computeRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  direction: TradeDirection,
): number {
  const risk =
    direction === "buy"
      ? Math.abs(entryPrice - stopLoss)
      : Math.abs(stopLoss - entryPrice);

  if (risk === 0) return 0;

  const actualPnl =
    direction === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;

  return actualPnl / risk;
}

/**
 * Weighted multi-TP PnL.
 *
 * When `split_risk` is true, the total quantity is spread evenly across
 * `num_positions` slices. Each slice's exit price is determined by its
 * per-TP outcome:
 *   hit → closes at that TP's price
 *   be  → closes at entry (break-even for that slice)
 *   sl  → closes at stop loss
 *   null (no result yet) → treated as unrealized; contributes 0 to PnL
 *
 * Fees are applied once to the total (not per-slice), since they represent
 * the true broker cost of the trade as a whole.
 *
 * Returns `null` when no TP has a concrete result yet (trade still open).
 */
interface MultiTpOutcome {
  readonly value: number;
  readonly price: number;
}

function priceForResult(
  result: TPResult,
  tpPrice: number | null | undefined,
  entryPrice: number,
  stopLoss: number | null,
): number | null {
  if (result === "hit") {
    return tpPrice != null && tpPrice > 0 ? tpPrice : null;
  }
  if (result === "be") {
    return entryPrice;
  }
  // sl
  return stopLoss != null && stopLoss > 0 ? stopLoss : null;
}

export function computeMultiTpPnl<T extends TradeForComputation>(
  trade: T,
): MultiTpOutcome | null {
  const results: ReadonlyArray<{ readonly price: number | null | undefined; readonly result: TPResult | null | undefined }> = [
    { price: trade.tp1, result: trade.tp1_result },
    { price: trade.tp2, result: trade.tp2_result },
    { price: trade.tp3, result: trade.tp3_result },
    { price: trade.tp4, result: trade.tp4_result },
    { price: trade.tp5, result: trade.tp5_result },
    { price: trade.tp6, result: trade.tp6_result },
    { price: trade.tp7, result: trade.tp7_result },
  ];

  const concrete = results.filter((r) => r.result != null);
  if (concrete.length === 0) return null;

  // Count how many TP price slots are populated. This is the "intended" number
  // of partial-close positions the user set up. We use it as the slice fallback
  // so that hitting TP2 out of 3 gives 1/3 position size per hit — not 1/2
  // (which would happen if we fell back to concrete.length=2 instead of 3).
  // If the user explicitly set num_positions we always honour that.
  const totalTpsSet = [
    trade.tp1, trade.tp2, trade.tp3, trade.tp4,
    trade.tp5, trade.tp6, trade.tp7,
  ].filter((p) => p != null && p > 0).length;

  const slices = Math.max(
    1,
    Math.min(10, trade.num_positions ?? Math.max(concrete.length, totalTpsSet)),
  );
  // Each concrete result closes out one slice (up to `slices` total).
  const perSliceQty = trade.quantity / slices;

  let realized = 0;
  let weightedExitNumerator = 0;
  let weightedExitQty = 0;

  const effectiveSlices = Math.min(concrete.length, slices);
  for (let i = 0; i < effectiveSlices; i += 1) {
    const { price, result } = concrete[i];
    if (result == null) continue;
    const exitPx = priceForResult(result, price, trade.entry_price, trade.stop_loss);
    if (exitPx == null) continue;

    const gross =
      trade.direction === "buy"
        ? (exitPx - trade.entry_price) * perSliceQty
        : (trade.entry_price - exitPx) * perSliceQty;
    realized += gross;
    weightedExitNumerator += exitPx * perSliceQty;
    weightedExitQty += perSliceQty;
  }

  if (weightedExitQty === 0) return null;

  return {
    value: realized - trade.fees,
    price: weightedExitNumerator / weightedExitQty,
  };
}

export function computeTradeFields<T extends TradeForComputation>(
  trade: T,
): T & {
  readonly pnl_absolute: number | null;
  readonly pnl_percentage: number | null;
  readonly risk_reward_ratio: number | null;
  readonly r_multiple: number | null;
  /**
   * Effective exit price. For legacy trades this is just `trade.exit_price`.
   * For multi-TP trades with at least one concrete tp_result, this is the
   * quantity-weighted exit derived from those results — so downstream code
   * that still keys off `exit_price` (analytics, equity curve, Pips column)
   * keeps working without needing to know about TP mechanics.
   */
  readonly exit_price: number | null;
} {
  // First TP (for R:R reference). Prefer tp1 > take_profit legacy fallback.
  const primaryTp = trade.tp1 ?? trade.take_profit ?? null;

  // Multi-TP path: any concrete tp*_result present?
  const hasAnyResult =
    trade.tp1_result != null ||
    trade.tp2_result != null ||
    trade.tp3_result != null ||
    trade.tp4_result != null ||
    trade.tp5_result != null ||
    trade.tp6_result != null ||
    trade.tp7_result != null;

  if (hasAnyResult) {
    const multi = computeMultiTpPnl(trade);
    if (multi !== null) {
      const pnlPercentage = computePnlPercentage(
        trade.entry_price,
        multi.price,
        trade.direction,
      );

      // For R:R, use the HIGHEST TP that was actually hit — not always TP1.
      // Scanning from TP7 down so the first match is the highest hit level.
      // Falls back to primaryTp (TP1 / legacy take_profit) when nothing is hit
      // yet (e.g. only BE / SL results recorded).
      const highestHitTp = (() => {
        const tpPairs: ReadonlyArray<{ result: TPResult | null | undefined; price: number | null | undefined }> = [
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
      })();
      const rrTp = highestHitTp ?? primaryTp;

      const riskRewardRatio =
        trade.stop_loss !== null && rrTp !== null
          ? computeRiskRewardRatio(
              trade.entry_price,
              trade.stop_loss,
              rrTp,
              trade.direction,
            )
          : null;
      const rMultiple =
        trade.stop_loss !== null
          ? computeRMultiple(
              trade.entry_price,
              multi.price,
              trade.stop_loss,
              trade.direction,
            )
          : null;

      return {
        ...trade,
        pnl_absolute: multi.value,
        pnl_percentage: pnlPercentage,
        risk_reward_ratio: riskRewardRatio,
        r_multiple: rMultiple,
        // Persist the weighted TP exit as `exit_price` so downstream
        // readers (Pips column, equity curve, drawdown chart) all see a
        // concrete closed price without needing TP-aware logic.
        exit_price: multi.price,
      };
    }
  }

  // Legacy single-exit path (back-compat for existing trades).
  if (trade.exit_price === null) {
    return {
      ...trade,
      pnl_absolute: null,
      pnl_percentage: null,
      risk_reward_ratio:
        trade.stop_loss !== null && primaryTp !== null
          ? computeRiskRewardRatio(
              trade.entry_price,
              trade.stop_loss,
              primaryTp,
              trade.direction,
            )
          : null,
      r_multiple: null,
      exit_price: null,
    };
  }

  const pnlAbsolute = computePnlAbsolute(
    trade.entry_price,
    trade.exit_price,
    trade.quantity,
    trade.direction,
    trade.fees,
  );

  const pnlPercentage = computePnlPercentage(
    trade.entry_price,
    trade.exit_price,
    trade.direction,
  );

  const riskRewardRatio =
    trade.stop_loss !== null && primaryTp !== null
      ? computeRiskRewardRatio(
          trade.entry_price,
          trade.stop_loss,
          primaryTp,
          trade.direction,
        )
      : null;

  const rMultiple =
    trade.stop_loss !== null
      ? computeRMultiple(
          trade.entry_price,
          trade.exit_price,
          trade.stop_loss,
          trade.direction,
        )
      : null;

  return {
    ...trade,
    pnl_absolute: pnlAbsolute,
    pnl_percentage: pnlPercentage,
    risk_reward_ratio: riskRewardRatio,
    r_multiple: rMultiple,
    exit_price: trade.exit_price,
  };
}
