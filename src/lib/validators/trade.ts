import { z } from "zod";
import { EMOTION_VALUES } from "@/lib/constants/emotions";

const assetTypes = [
  "forex",
  "crypto",
  "metal",
  "commodity",
  "index",
] as const;
const directions = ["buy", "sell"] as const;
const sources = ["manual", "csv", "mt5_webhook"] as const;
const orderTypes = ["market", "limit", "stop"] as const;
const tpResults = ["hit", "be", "sl"] as const;

type TpKey =
  | "tp1"
  | "tp2"
  | "tp3"
  | "tp4"
  | "tp5"
  | "tp6"
  | "tp7";

/**
 * Direction-aware geometry for optional SL + multi-TP.
 *
 * Rules:
 * - SL (if provided) must sit on the losing side of entry relative to direction.
 * - Each TP (if provided) must sit on the winning side of entry.
 * - Multi-TP ordering: TP1 → TP7 must be monotonically farther from entry in
 *   the winning direction (TP2 more profitable than TP1, etc.). Gaps are
 *   allowed (e.g. only TP1 + TP7 set), but the set values must respect order.
 * - `entry_price_high` (when set) must be >= entry_price.
 *
 * Only applied when the relevant field is present, so open trades without
 * SL/TPs still validate.
 */
function refineTradeGeometry(
  data: {
    readonly direction: "buy" | "sell";
    readonly entry_price: number;
    readonly entry_price_high?: number | null;
    readonly stop_loss?: number | null;
    readonly take_profit?: number | null;
    readonly tp1?: number | null;
    readonly tp2?: number | null;
    readonly tp3?: number | null;
    readonly tp4?: number | null;
    readonly tp5?: number | null;
    readonly tp6?: number | null;
    readonly tp7?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const { direction, entry_price, entry_price_high, stop_loss } = data;

  // Entry range
  if (
    entry_price_high != null &&
    Number.isFinite(entry_price_high) &&
    entry_price_high < entry_price
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entry_price_high"],
      message: "Entry price high must be ≥ entry price",
    });
  }

  // SL
  if (direction === "buy") {
    if (stop_loss != null && stop_loss >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stop_loss"],
        message: "Stop loss must be below entry price for a buy trade",
      });
    }
  } else {
    if (stop_loss != null && stop_loss <= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stop_loss"],
        message: "Stop loss must be above entry price for a sell trade",
      });
    }
  }

  // Legacy single TP (take_profit)
  if (data.take_profit != null) {
    if (direction === "buy" && data.take_profit <= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["take_profit"],
        message: "Take profit must be above entry price for a buy trade",
      });
    }
    if (direction === "sell" && data.take_profit >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["take_profit"],
        message: "Take profit must be below entry price for a sell trade",
      });
    }
  }

  // Multi-TP checks
  const tps: ReadonlyArray<{ readonly key: TpKey; readonly value: number | null | undefined }> = [
    { key: "tp1", value: data.tp1 },
    { key: "tp2", value: data.tp2 },
    { key: "tp3", value: data.tp3 },
    { key: "tp4", value: data.tp4 },
    { key: "tp5", value: data.tp5 },
    { key: "tp6", value: data.tp6 },
    { key: "tp7", value: data.tp7 },
  ];

  // Each TP must be on the winning side of entry
  for (const { key, value } of tps) {
    if (value == null) continue;
    if (direction === "buy" && value <= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key.toUpperCase()} must be above entry price for a buy trade`,
      });
    }
    if (direction === "sell" && value >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key.toUpperCase()} must be below entry price for a sell trade`,
      });
    }
  }

  // TP ordering: for buys, tp1 < tp2 < ... < tp7; reversed for sells.
  const filled = tps.filter((t) => t.value != null) as ReadonlyArray<{
    readonly key: TpKey;
    readonly value: number;
  }>;
  for (let i = 1; i < filled.length; i += 1) {
    const prev = filled[i - 1];
    const curr = filled[i];
    if (direction === "buy" && curr.value <= prev.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [curr.key],
        message: `${curr.key.toUpperCase()} must be greater than ${prev.key.toUpperCase()} for a buy trade`,
      });
    }
    if (direction === "sell" && curr.value >= prev.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [curr.key],
        message: `${curr.key.toUpperCase()} must be less than ${prev.key.toUpperCase()} for a sell trade`,
      });
    }
  }
}

const createTradeObjectSchema = z.object({
  user_id: z.string().trim().min(1),
  instrument: z.string().trim().min(1).max(20),
  asset_type: z.enum(assetTypes),
  direction: z.enum(directions),
  order_type: z.enum(orderTypes).default("market"),
  entry_price: z.coerce.number().positive(),
  entry_price_high: z.coerce.number().positive().nullable().optional(),
  exit_price: z.coerce.number().positive().nullable().optional(),
  quantity: z.coerce.number().positive(),
  lot_size: z.coerce.number().positive().nullable().optional(),
  stop_loss: z.coerce.number().positive().nullable().optional(),
  sl_pips: z.coerce.number().nonnegative().nullable().optional(),
  // Legacy single-TP — kept in sync with tp1 when only one target is set.
  take_profit: z.coerce.number().positive().nullable().optional(),
  tp1: z.coerce.number().positive().nullable().optional(),
  tp2: z.coerce.number().positive().nullable().optional(),
  tp3: z.coerce.number().positive().nullable().optional(),
  tp4: z.coerce.number().positive().nullable().optional(),
  tp5: z.coerce.number().positive().nullable().optional(),
  tp6: z.coerce.number().positive().nullable().optional(),
  tp7: z.coerce.number().positive().nullable().optional(),
  tp1_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp2_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp3_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp4_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp5_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp6_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp7_pips: z.coerce.number().nonnegative().nullable().optional(),
  tp1_result: z.enum(tpResults).nullable().optional(),
  tp2_result: z.enum(tpResults).nullable().optional(),
  tp3_result: z.enum(tpResults).nullable().optional(),
  tp4_result: z.enum(tpResults).nullable().optional(),
  tp5_result: z.enum(tpResults).nullable().optional(),
  tp6_result: z.enum(tpResults).nullable().optional(),
  tp7_result: z.enum(tpResults).nullable().optional(),
  tp4_trailing: z.coerce.boolean().default(false),
  num_positions: z.coerce.number().int().min(1).max(10).default(1),
  split_risk: z.coerce.boolean().default(false),
  fees: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim()).default([]),
  // Psychology — optional single-select at two stages. Same vocabulary.
  emotion: z.enum(EMOTION_VALUES).nullable().optional(),
  emotion_post: z.enum(EMOTION_VALUES).nullable().optional(),
  entry_time: z.string().trim().min(1),
  exit_time: z.string().trim().nullable().optional(),
  source: z.enum(sources).default("manual"),
});

export const createTradeSchema =
  createTradeObjectSchema.superRefine(refineTradeGeometry);

// Form-facing variant: client forms don't set `user_id` (it's attached server-
// side from the session). We omit it BEFORE refining because Zod forbids
// `.omit()` on a ZodEffects (refined) schema. Re-applying the geometry refine
// keeps SL/TP direction invariants enforced in the form.
//
// `tags` and `notes` are explicitly made form-friendly:
//   - tags: the <input> is a comma-separated text field, so an empty input
//     arrives as "" (string), not undefined. `z.array(...).default([])` only
//     fills in defaults for `undefined`, so without preprocessing an empty
//     tags field silently fails validation and blocks submit. Preprocess
//     accepts array-passthrough OR splits a comma string; empty → [].
//   - notes: a blank textarea yields "" which already satisfies `z.string()`,
//     but we normalize to null so empty notes don't round-trip as empty
//     strings into the DB. Keeps the field genuinely optional.
const formTagsField = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string().trim()).default([]));

const formNotesField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().max(5000).nullable().optional(),
);

export const createTradeFormSchema = createTradeObjectSchema
  .omit({ user_id: true, tags: true, notes: true })
  .extend({ tags: formTagsField, notes: formNotesField })
  .superRefine(refineTradeGeometry);

// updateTradeSchema: need partial + geometry check only when direction +
// entry_price both present. superRefine handles the guard.
export const updateTradeSchema = createTradeObjectSchema
  .partial()
  .superRefine((data, ctx) => {
    if (
      data.direction !== undefined &&
      data.entry_price !== undefined &&
      typeof data.entry_price === "number"
    ) {
      refineTradeGeometry(
        {
          direction: data.direction,
          entry_price: data.entry_price,
          entry_price_high: data.entry_price_high ?? null,
          stop_loss: data.stop_loss ?? null,
          take_profit: data.take_profit ?? null,
          tp1: data.tp1 ?? null,
          tp2: data.tp2 ?? null,
          tp3: data.tp3 ?? null,
          tp4: data.tp4 ?? null,
          tp5: data.tp5 ?? null,
          tp6: data.tp6 ?? null,
          tp7: data.tp7 ?? null,
        },
        ctx,
      );
    }
  });

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
