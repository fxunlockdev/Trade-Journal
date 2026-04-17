import { z } from "zod";

const assetTypes = [
  "forex",
  "crypto",
  "metal",
  "commodity",
  "index",
] as const;
const directions = ["buy", "sell"] as const;
const sources = ["manual", "csv", "mt5_webhook"] as const;

/**
 * Direction-aware geometry for optional SL/TP.
 * Ported from validators/signal.ts so manually-logged trades enforce
 * the same physical invariants as signals (buy → SL<entry<TP, etc.).
 * Applied only when the relevant field is present, so open trades
 * without a TP/SL still validate.
 */
function refineTradeGeometry(
  data: {
    readonly direction: "buy" | "sell";
    readonly entry_price: number;
    readonly stop_loss?: number | null;
    readonly take_profit?: number | null;
    readonly exit_price?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const { direction, entry_price, stop_loss, take_profit } = data;

  if (direction === "buy") {
    if (stop_loss != null && stop_loss >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stop_loss"],
        message: "Stop loss must be below entry price for a buy trade",
      });
    }
    if (take_profit != null && take_profit <= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["take_profit"],
        message: "Take profit must be above entry price for a buy trade",
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
    if (take_profit != null && take_profit >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["take_profit"],
        message: "Take profit must be below entry price for a sell trade",
      });
    }
  }
}

const createTradeObjectSchema = z.object({
  user_id: z.string().trim().min(1),
  instrument: z.string().trim().min(1).max(20),
  asset_type: z.enum(assetTypes),
  direction: z.enum(directions),
  entry_price: z.coerce.number().positive(),
  exit_price: z.coerce.number().positive().nullable().optional(),
  quantity: z.coerce.number().positive(),
  lot_size: z.coerce.number().positive().nullable().optional(),
  stop_loss: z.coerce.number().positive().nullable().optional(),
  take_profit: z.coerce.number().positive().nullable().optional(),
  fees: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim()).default([]),
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
          stop_loss: data.stop_loss ?? null,
          take_profit: data.take_profit ?? null,
        },
        ctx,
      );
    }
  });

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
