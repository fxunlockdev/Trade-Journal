import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { quoteToUsdFactor } from "@/lib/trading/quote-conversion";
import type { TradeDirection, TPResult } from "@/types/database";

interface TradeForComputation {
  /**
   * Needed to value the trade in the account currency: `priceMove × quantity`
   * is denominated in the instrument's QUOTE currency, so a JPY-quoted pair has
   * to be converted or its P&L reads ~164× too large. Optional so legacy
   * callers still type-check; when absent the figure stays in the quote
   * currency (correct for the USD-quoted majority).
   */
  readonly instrument?: string | null;
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

/**
 * How a P&L figure ends up denominated.
 *
 * The old version returned a bare number and threw away `approximate`/`note`,
 * so nothing downstream could tell a figure converted at a real rate from one
 * derived from the hardcoded `EUR: 1.08`. Both were stored as "dollars" and
 * neither could be found again to put right.
 */
export type PnlRateQuality = "broker" | "exact" | "approximate" | "assumed";

export interface PnlDenomination {
  /** Multiply the raw quote-currency amount by this. */
  readonly factor: number;
  /** What the resulting figure is in. Null when the instrument is unknown. */
  readonly currency: string | null;
  readonly quality: PnlRateQuality;
}

export function resolvePnlDenomination(
  instrument: string | null | undefined,
  price: number,
): PnlDenomination {
  // No instrument means no scaling — correct for every USD-quoted symbol, and
  // the contract legacy callers rely on. But we cannot name the currency, so
  // it is recorded as assumed rather than asserted to be USD.
  if (!instrument) return { factor: 1, currency: null, quality: "assumed" };

  const spec = getInstrumentSpec(instrument);
  const conversion = quoteToUsdFactor({
    quoteCurrency: spec.quoteCurrency,
    baseCurrency: spec.baseCurrency,
    price,
  });

  return {
    factor: conversion.factor,
    currency: conversion.currency,
    // `approximate` is only true for the hardcoded table AND for an unknown
    // currency — but the latter performs no conversion at all, so the figure is
    // exactly what it claims to be, just in a different currency.
    quality:
      conversion.approximate && conversion.currency === "USD"
        ? "approximate"
        : "exact",
  };
}

/** Backwards-compatible factor-only accessor for the arithmetic below. */
function accountCurrencyFactor(
  instrument: string | null | undefined,
  price: number,
): number {
  return resolvePnlDenomination(instrument, price).factor;
}

/**
 * Realized P&L in the ACCOUNT currency.
 *
 * `priceMove × quantity` is denominated in the instrument's quote currency, so
 * it must be converted before it can be called dollars. Skipping that step
 * reported a 10-pip USDJPY trade as "$10.00" when it was 10 JPY ≈ $0.06 — a
 * 164× overstatement that made JPY pairs incomparable with EURUSD/GBPUSD.
 *
 * Fees are already in the account currency, so they're subtracted after the
 * conversion.
 */
export function computePnlAbsolute(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  direction: TradeDirection,
  fees: number,
  instrument?: string | null,
): number {
  const rawPnl =
    direction === "buy"
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
  // Convert at the EXIT price: that's the rate the position was closed at.
  return rawPnl * accountCurrencyFactor(instrument, exitPrice) - fees;
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

/** The TP slots of a trade, in order, as {price, result} pairs. */
function tpSlots<T extends TradeForComputation>(
  trade: T,
): ReadonlyArray<{
  readonly price: number | null | undefined;
  readonly result: TPResult | null | undefined;
}> {
  return [
    { price: trade.tp1, result: trade.tp1_result },
    { price: trade.tp2, result: trade.tp2_result },
    { price: trade.tp3, result: trade.tp3_result },
    { price: trade.tp4, result: trade.tp4_result },
    { price: trade.tp5, result: trade.tp5_result },
    { price: trade.tp6, result: trade.tp6_result },
    { price: trade.tp7, result: trade.tp7_result },
  ];
}

/**
 * The furthest target marked "hit", measured in the winning direction — the
 * best level the trade actually reached. Null when nothing was hit.
 *
 * Single source of truth for "which target did this trade reach": the exit
 * price, the R-multiple and the displayed R:R all resolve through here, so one
 * row can never show an exit derived one way and an R:R derived another.
 * Targets with no usable price (a trailing target whose price box is disabled,
 * or a NaN) are skipped rather than counted.
 */
export function furthestHitTpPrice<T extends TradeForComputation>(
  trade: T,
): number | null {
  let best: number | null = null;
  for (const slot of tpSlots(trade)) {
    if (slot.result !== "hit") continue;
    const price = slot.price;
    if (price == null || !(price > 0)) continue; // also rejects NaN
    if (best === null) best = price;
    else best = trade.direction === "buy" ? Math.max(best, price) : Math.min(best, price);
  }
  return best;
}

/**
 * Where a SINGLE position closed.
 *
 * Banked levels stay banked. If ANY target was hit, the trade closed at the
 * FURTHEST hit target — a `be` or `sl` marked on a later target describes the
 * runner coming back, not the whole position unwinding. Reading that later
 * marker as the close collapsed the trade to its entry price (P&L 0) and
 * silently erased every target already reached.
 *
 * With no hit at all, the stop is the close; failing that, break-even (entry).
 * Unresolvable outcomes fall through instead of nulling the trade, so a
 * priceless target can't drop a real trade out of every money metric.
 */
function singlePositionExit<T extends TradeForComputation>(
  trade: T,
  results: ReadonlyArray<{
    readonly price: number | null | undefined;
    readonly result: TPResult | null | undefined;
  }>,
): number | null {
  const hit = furthestHitTpPrice(trade);
  if (hit !== null) return hit;

  if (results.some((r) => r.result === "sl")) {
    const stop = priceForResult("sl", null, trade.entry_price, trade.stop_loss);
    if (stop !== null) return stop;
  }
  if (results.some((r) => r.result === "be")) return trade.entry_price;
  return null;
}

export function computeMultiTpPnl<T extends TradeForComputation>(
  trade: T,
): MultiTpOutcome | null {
  const results = tpSlots(trade);

  const concrete = results.filter((r) => r.result != null);
  if (concrete.length === 0) return null;

  /**
   * SINGLE position (not split, or only one position): the trade closes ONCE,
   * at the furthest target it reached — so with TP1+TP2 hit the exit is TP2,
   * and a break-even marked on TP3 leaves those banked levels intact. The slice
   * logic below would collapse to `concrete[0]` here (slices = num_positions =
   * 1), which counted only TP1 and under-reported exit price, pips and P&L for
   * every multi-target trade.
   */
  const isSplit = (trade.split_risk ?? false) && (trade.num_positions ?? 1) > 1;
  if (!isSplit) {
    const exitPx = singlePositionExit(trade, results);
    if (exitPx == null) return null;

    const gross =
      trade.direction === "buy"
        ? (exitPx - trade.entry_price) * trade.quantity
        : (trade.entry_price - exitPx) * trade.quantity;
    // Quote currency → account currency, same as the single-exit path.
    const value =
      gross * accountCurrencyFactor(trade.instrument, exitPx) - trade.fees;
    return { value, price: exitPx };
  }

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
    // Each slice converts at its OWN exit price — for an indirect quote
    // (USDJPY) the rate moves with the price, so slices closed at different
    // levels convert at different rates.
    realized += gross * accountCurrencyFactor(trade.instrument, exitPx);
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
  /**
   * What `pnl_absolute` is denominated in, and how well that is known. A money
   * figure with no unit is what let a EUR-deposit account store euros in a
   * column every reader treated as dollars.
   */
  readonly pnl_currency: string | null;
  readonly pnl_rate_quality: PnlRateQuality | null;
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

      // R:R measures to the furthest TP actually hit — the same resolver the
      // exit price uses, so the two can never disagree on one row. Falls back
      // to primaryTp (TP1 / legacy take_profit) when nothing was hit (e.g. only
      // BE / SL recorded).
      const rrTp = furthestHitTpPrice(trade) ?? primaryTp;

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

      const denom = resolvePnlDenomination(trade.instrument, multi.price);
      return {
        ...trade,
        pnl_absolute: multi.value,
        pnl_currency: denom.currency,
        pnl_rate_quality: denom.quality,
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
  if (trade.exit_price == null) {
    return {
      ...trade,
      pnl_absolute: null,
      // No realized figure yet, so there is nothing to denominate.
      pnl_currency: null,
      pnl_rate_quality: null,
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
    trade.instrument,
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

  const denom = resolvePnlDenomination(trade.instrument, trade.exit_price);
  return {
    ...trade,
    pnl_absolute: pnlAbsolute,
    pnl_currency: denom.currency,
    pnl_rate_quality: denom.quality,
    pnl_percentage: pnlPercentage,
    risk_reward_ratio: riskRewardRatio,
    r_multiple: rMultiple,
    exit_price: trade.exit_price,
  };
}
