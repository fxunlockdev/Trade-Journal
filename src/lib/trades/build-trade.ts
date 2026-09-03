/**
 * The one pipeline from "fields somebody typed" to "a row the trades table
 * accepts": validate, normalise, compute, stamp ownership.
 *
 * Three routes used to carry their own copy of the middle two steps -- the
 * form, the AI chat and the Telegram bot -- and the copies had already
 * drifted (one omitted `journal_id` for two months; one relied on schema
 * defaults the others spelled out). A trade logged from any of the three must
 * be indistinguishable on the row, so there is one function.
 *
 * Pure apart from the schema: no client, no I/O. The caller owns the insert.
 */

import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { tradeInsertPayload, type TradeOwnership } from "@/lib/trades/insert-payload";

export type TradeInput = Record<string, unknown>;

/** Everything the schema accepted, with every nullable column made explicit. */
function normalise(d: ReturnType<typeof createTradeSchema.parse>) {
  // Keep `take_profit` (legacy single-TP) in sync with `tp1` so older reports
  // and MT5 webhook readers keep working.
  const tp1 = d.tp1 ?? null;
  const legacyTp = tp1 ?? d.take_profit ?? null;
  return {
    ...d,
    exit_price: d.exit_price ?? null,
    entry_price_high: d.entry_price_high ?? null,
    stop_loss: d.stop_loss ?? null,
    sl_pips: d.sl_pips ?? null,
    take_profit: legacyTp,
    tp1,
    tp2: d.tp2 ?? null,
    tp3: d.tp3 ?? null,
    tp4: d.tp4 ?? null,
    tp5: d.tp5 ?? null,
    tp6: d.tp6 ?? null,
    tp7: d.tp7 ?? null,
    tp1_pips: d.tp1_pips ?? null,
    tp2_pips: d.tp2_pips ?? null,
    tp3_pips: d.tp3_pips ?? null,
    tp4_pips: d.tp4_pips ?? null,
    tp5_pips: d.tp5_pips ?? null,
    tp6_pips: d.tp6_pips ?? null,
    tp7_pips: d.tp7_pips ?? null,
    tp1_result: d.tp1_result ?? null,
    tp2_result: d.tp2_result ?? null,
    tp3_result: d.tp3_result ?? null,
    tp4_result: d.tp4_result ?? null,
    tp5_result: d.tp5_result ?? null,
    tp6_result: d.tp6_result ?? null,
    tp7_result: d.tp7_result ?? null,
    tp4_trailing: d.tp4_trailing ?? false,
    order_type: d.order_type ?? "market",
    num_positions: d.num_positions ?? 1,
    split_risk: d.split_risk ?? false,
    lot_size: d.lot_size ?? null,
    notes: d.notes ?? null,
    exit_time: d.exit_time ?? null,
  };
}

export type TradeRow = ReturnType<typeof tradeInsertPayload<ReturnType<typeof computeTradeFields<ReturnType<typeof normalise>>>>>;

export type BuildTradeResult =
  | { readonly ok: true; readonly row: TradeRow }
  | {
      readonly ok: false;
      /** "field: message", one per problem. */
      readonly issues: readonly string[];
      /** The schema's own grouping, for API responses that return it. */
      readonly fieldErrors: Record<string, readonly string[] | undefined>;
    };

/**
 * Build the row, or say what is wrong with the input.
 *
 * `user_id` in the input is ignored: it comes from the verified session via
 * `ownership`. So do `journal_id` and `source`, which the schema strips and
 * `tradeInsertPayload` stamps last.
 */
export function buildTradeRow(input: TradeInput, ownership: TradeOwnership): BuildTradeResult {
  const parsed = createTradeSchema.safeParse({ ...input, user_id: ownership.userId });
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message,
      ),
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, readonly string[] | undefined>,
    };
  }
  const computed = computeTradeFields(normalise(parsed.data));
  return { ok: true, row: tradeInsertPayload(computed, ownership) };
}
