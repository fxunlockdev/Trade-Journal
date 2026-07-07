import {
  computePnlPercentage,
  computeRMultiple,
  computeRiskRewardRatio,
} from "@/lib/trades/computations";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { normalizeMt5Symbol } from "@/lib/mt5/normalize-symbol";
import type { Mt5Event } from "@/lib/validators/mt5";

/**
 * Pure MT5-event → trade-row mapping. Kept free of I/O so the whole mapping
 * layer can be exercised from a plain node script (see PR test notes).
 *
 * Money semantics (validated against app conventions):
 * - `quantity` is UNITS (volume × contractSize) to match the manual form's
 *   "Total units / contracts" meaning; `lot_size` keeps the raw MT5 lots.
 * - `pnl_absolute` is MT5-authoritative: profit + commission + swap — the
 *   broker's real money number. We never derive it from price × volume.
 * - `fees` is display-only: the cost portion (commission + swap) when
 *   negative overall; net PnL stays exact regardless.
 */

function toIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** SL must sit on the LOSING side of entry for risk math to mean anything. */
function isSlValid(
  direction: "buy" | "sell",
  entryPrice: number,
  stopLoss: number | null | undefined,
): stopLoss is number {
  if (stopLoss == null || stopLoss <= 0) return false;
  return direction === "buy" ? stopLoss < entryPrice : stopLoss > entryPrice;
}

interface PipFields {
  readonly sl_pips: number | null;
  readonly tp1_pips: number | null;
}

function computePipFields(
  instrument: string,
  entryPrice: number,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): PipFields {
  const spec = getInstrumentSpec(instrument);
  if (spec.pipSize <= 0) return { sl_pips: null, tp1_pips: null };
  return {
    sl_pips:
      stopLoss != null && stopLoss > 0
        ? round1(Math.abs(entryPrice - stopLoss) / spec.pipSize)
        : null,
    tp1_pips:
      takeProfit != null && takeProfit > 0
        ? round1(Math.abs(takeProfit - entryPrice) / spec.pipSize)
        : null,
  };
}

/**
 * Fields shared by every write for this event (open/update upserts). Mirrors
 * the shape POST /api/trades inserts — every nullable explicitly null so
 * Supabase gets a clean row.
 */
export function buildTradeRow(
  event: Mt5Event,
  accountKey: string,
  userId: string,
  journalId: string,
): Record<string, unknown> {
  const { instrument, assetType } = normalizeMt5Symbol(event.symbol);
  const spec = getInstrumentSpec(instrument);
  const sl = event.sl ?? null;
  const tp = event.tp ?? null;
  const pips = computePipFields(instrument, event.entry_price, sl, tp);

  return {
    user_id: userId,
    journal_id: journalId,
    instrument,
    asset_type: assetType,
    direction: event.direction,
    order_type: "market",
    entry_price: event.entry_price,
    entry_price_high: null,
    exit_price: null,
    quantity: event.volume * spec.contractSize,
    lot_size: event.volume,
    stop_loss: sl,
    sl_pips: pips.sl_pips,
    // Legacy single-TP stays in sync with tp1 (older readers depend on it).
    take_profit: tp,
    tp1: tp,
    tp2: null,
    tp3: null,
    tp4: null,
    tp5: null,
    tp6: null,
    tp7: null,
    tp1_pips: pips.tp1_pips,
    tp2_pips: null,
    tp3_pips: null,
    tp4_pips: null,
    tp5_pips: null,
    tp6_pips: null,
    tp7_pips: null,
    // All tp*_result stay null — any non-null value would flip
    // computeTradeFields into the multi-TP path on later app-side edits.
    tp1_result: null,
    tp2_result: null,
    tp3_result: null,
    tp4_result: null,
    tp5_result: null,
    tp6_result: null,
    tp7_result: null,
    tp4_trailing: false,
    num_positions: 1,
    split_risk: false,
    fees: 0,
    notes: null,
    tags: [],
    entry_time: toIso(event.open_time),
    exit_time: null,
    pnl_absolute: null,
    pnl_percentage: null,
    risk_reward_ratio: null,
    r_multiple: null,
    source: "mt5_webhook",
    mt5_account: accountKey,
    mt5_ticket: event.ticket,
  };
}

/**
 * Patch for a repeated `open` event on an existing row. Netting accounts
 * re-average the entry and change volume as positions add up — mirror MT5.
 */
export function buildOpenUpdatePatch(event: Mt5Event): Record<string, unknown> {
  const { instrument } = normalizeMt5Symbol(event.symbol);
  const spec = getInstrumentSpec(instrument);
  return {
    entry_price: event.entry_price,
    quantity: event.volume * spec.contractSize,
    lot_size: event.volume,
    ...buildSlTpPatch(event),
  };
}

/** SL/TP patch for `update` events (and non-final close snapshots). */
export function buildSlTpPatch(event: Mt5Event): Record<string, unknown> {
  const { instrument } = normalizeMt5Symbol(event.symbol);
  const sl = event.sl ?? null;
  const tp = event.tp ?? null;
  const pips = computePipFields(instrument, event.entry_price, sl, tp);
  return {
    stop_loss: sl,
    sl_pips: pips.sl_pips,
    take_profit: tp,
    tp1: tp,
    tp1_pips: pips.tp1_pips,
  };
}

/**
 * Exit fields for a FINAL close. `profit`/`commission`/`swap` are cumulative
 * across all partial closes (the EA aggregates via HistorySelectByPosition),
 * so replays and out-of-order snapshots simply overwrite with the same data.
 */
export function buildCloseFields(event: Mt5Event): Record<string, unknown> {
  const exitPrice = event.exit_price as number; // schema-enforced on close
  const commission = event.commission ?? 0;
  const swap = event.swap ?? 0;
  const netPnl = (event.profit ?? 0) + commission + swap;
  const costs = commission + swap;

  const slValid = isSlValid(event.direction, event.entry_price, event.sl);

  return {
    exit_price: exitPrice,
    exit_time: event.close_time != null ? toIso(event.close_time) : null,
    pnl_absolute: netPnl,
    pnl_percentage: computePnlPercentage(
      event.entry_price,
      exitPrice,
      event.direction,
    ),
    fees: Math.max(0, -costs),
    // Risk math only when the SL is on the losing side — a trailed SL past
    // entry (common on live MT5) would otherwise produce nonsense R values.
    risk_reward_ratio:
      slValid && event.tp != null && event.tp > 0
        ? computeRiskRewardRatio(
            event.entry_price,
            event.sl as number,
            event.tp,
            event.direction,
          )
        : null,
    r_multiple: slValid
      ? computeRMultiple(
          event.entry_price,
          exitPrice,
          event.sl as number,
          event.direction,
        )
      : null,
  };
}
