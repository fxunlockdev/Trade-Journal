import {
  computePnlPercentage,
  computeRMultiple,
  computeRiskRewardRatio,
} from "@/lib/trades/computations";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { normalizeMt5Symbol } from "@/lib/mt5/normalize-symbol";
import type { Mt5Event } from "@/lib/validators/mt5";
import type { TPResult } from "@/types/database";

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

/**
 * SL must sit on the LOSING side of entry, TP on the WINNING side — the same
 * geometry the trades table enforces (a CHECK the manual form mirrors in
 * `refineTradeGeometry`). Live MT5 data legitimately violates this: a stop
 * moved to break-even sits AT entry, a trailed stop can sit PAST it. Persisting
 * such a value makes the INSERT fail the constraint, and the whole trade — its
 * real P&L included — silently vanishes. So the ingest stores SL/TP only when
 * geometrically valid, and nulls them otherwise. The trade always lands; only
 * the unusable risk marker is dropped (risk math already guards on the same
 * predicate, so nothing downstream regresses).
 */
function isSlValid(
  direction: "buy" | "sell",
  entryPrice: number,
  stopLoss: number | null | undefined,
): stopLoss is number {
  if (stopLoss == null || stopLoss <= 0) return false;
  return direction === "buy" ? stopLoss < entryPrice : stopLoss > entryPrice;
}

function isTpValid(
  direction: "buy" | "sell",
  entryPrice: number,
  takeProfit: number | null | undefined,
): takeProfit is number {
  if (takeProfit == null || takeProfit <= 0) return false;
  return direction === "buy" ? takeProfit > entryPrice : takeProfit < entryPrice;
}

/** Keep SL/TP only when on the geometrically valid side of entry; else null. */
function sanitizeSlTp(event: Mt5Event): {
  readonly sl: number | null;
  readonly tp: number | null;
} {
  return {
    sl: isSlValid(event.direction, event.entry_price, event.sl) ? event.sl : null,
    tp: isTpValid(event.direction, event.entry_price, event.tp) ? event.tp : null,
  };
}

/**
 * Which level, if any, closed the position — so the journal can show a trade
 * as "TP hit" / "SL hit" instead of a bare exit.
 *
 * MT5 reports don't state the close reason on the position row, but the fill
 * geometry is unambiguous: a TP is a LIMIT that fills at its price or better,
 * an SL is a STOP that fills at its price or worse (and occasionally a hair
 * better). So the position closed at TP when the exit reached the TP side of
 * it, and at SL when it reached the SL side — with a small tolerance for
 * rounding and stop slippage. A manual close lands short of the level and
 * stays null. Only the geometrically valid (persisted) SL/TP are considered,
 * so a break-even/trailed stop that we dropped can't be mislabelled as hit.
 *
 * `tp1_result` is the single-position marker; multi-TP splits aren't inferred
 * from a report (there's one closing price per position). It never changes the
 * stored P&L — the broker's number stays authoritative (see buildCloseFields).
 *
 * Tolerance is deliberately tight (1 pip). A TP limit fills at its price or
 * better, an SL stop at its price or a touch worse, so a real hit sits within
 * ~1 pip. A position closed 2+ pips short of its TP (e.g. a partial manual
 * close whose averaged exit lands near the target) must NOT be read as a hit.
 */
const EXIT_MATCH_PIPS = 1;

function detectCloseResult(
  event: Mt5Event,
  sl: number | null,
  tp: number | null,
  netPnl: number,
): TPResult | null {
  const exit = event.exit_price;
  if (exit == null) return null;

  const buy = event.direction === "buy";
  const { instrument } = normalizeMt5Symbol(event.symbol);
  const spec = getInstrumentSpec(instrument);
  const tol = spec.pipSize > 0 ? spec.pipSize * EXIT_MATCH_PIPS : 0;

  // TP fills at its price or better; SL at its price or worse.
  const reachedTp = tp != null && (buy ? exit >= tp - tol : exit <= tp + tol);
  const reachedSl = sl != null && (buy ? exit <= sl + tol : exit >= sl - tol);
  // Which side of entry the exit actually landed on (strict — a flat/break-even
  // close belongs to neither, so it is never mislabelled).
  const priceWon = buy ? exit > event.entry_price : exit < event.entry_price;
  const priceLost = buy ? exit < event.entry_price : exit > event.entry_price;

  // A TP hit is a win and an SL hit is a loss, so require BOTH the price side
  // and the net P&L to agree. This keeps the marker consistent with the money
  // (the table status derived from it can't contradict win-rate analytics) and,
  // when a tight scalp's TP and SL tolerance bands overlap, prevents a losing
  // stop-out from being read as a "hit".
  if (reachedTp && priceWon && netPnl > 0) return "hit";
  if (reachedSl && priceLost && netPnl < 0) return "sl";
  return null;
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
  const { sl, tp } = sanitizeSlTp(event);
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
  const { sl, tp } = sanitizeSlTp(event);
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
export function buildCloseFields(
  event: Mt5Event,
  /**
   * The account's deposit currency and how we came by it. `pnl_absolute` here
   * is the BROKER's own figure, never converted, so it is denominated in the
   * account's currency — not in USD, and not in the instrument's quote
   * currency. Recording it is what stops a EUR account's euros being read as
   * dollars downstream.
   */
  denomination?: {
    readonly currency: string | null;
    readonly quality: "broker" | "assumed";
  },
): Record<string, unknown> {
  const exitPrice = event.exit_price as number; // schema-enforced on close
  const commission = event.commission ?? 0;
  const swap = event.swap ?? 0;
  const netPnl = (event.profit ?? 0) + commission + swap;
  const costs = commission + swap;

  // Use the persisted (geometrically valid) SL/TP for every derivation, so the
  // close-reason, R:R and R-multiple all agree with what the row actually holds.
  const { sl, tp } = sanitizeSlTp(event);

  return {
    exit_price: exitPrice,
    exit_time: event.close_time != null ? toIso(event.close_time) : null,
    pnl_absolute: netPnl,
    pnl_currency: denomination?.currency ?? null,
    pnl_rate_quality: denomination?.currency ? denomination.quality : null,
    pnl_percentage: computePnlPercentage(
      event.entry_price,
      exitPrice,
      event.direction,
    ),
    fees: Math.max(0, -costs),
    // Mark whether the exit hit TP or SL — drives the journal's TP/SL-hit
    // display. Purely a label: pnl_absolute above stays the broker's number.
    tp1_result: detectCloseResult(event, sl, tp, netPnl),
    // Risk math only when the SL is on the losing side — a trailed SL past
    // entry (common on live MT5) would otherwise produce nonsense R values.
    risk_reward_ratio:
      sl != null && tp != null
        ? computeRiskRewardRatio(event.entry_price, sl, tp, event.direction)
        : null,
    r_multiple:
      sl != null
        ? computeRMultiple(event.entry_price, exitPrice, sl, event.direction)
        : null,
  };
}
