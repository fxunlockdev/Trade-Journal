import { z } from "zod";
import { SIGNAL_STATUSES } from "@/lib/constants/signal-status";

const directions = ["buy", "sell"] as const;

/**
 * Direction-aware geometry refinement:
 *   - buy  → SL below entry, every TP above entry
 *   - sell → SL above entry, every TP below entry
 *
 * Without this guard the form accepts signals that are physically
 * impossible (e.g. buy with SL above entry), and downstream R:R math
 * silently produces negative or nonsensical ratios.
 */
type SignalGeometry = {
  readonly direction: "buy" | "sell";
  readonly entry_price: number;
  readonly stop_loss: number;
  readonly tp1?: number | null;
  readonly tp2?: number | null;
  readonly tp3?: number | null;
  readonly tp4?: number | null;
};

function refineSignalGeometry(
  data: SignalGeometry,
  ctx: z.RefinementCtx,
): void {
  const { direction, entry_price, stop_loss } = data;
  const tps: readonly ("tp1" | "tp2" | "tp3" | "tp4")[] = [
    "tp1",
    "tp2",
    "tp3",
    "tp4",
  ];

  if (direction === "buy") {
    if (stop_loss >= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stop_loss"],
        message: "Stop loss must be below entry price for a buy signal",
      });
    }
    for (const key of tps) {
      const tp = data[key];
      if (tp != null && tp <= entry_price) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key.toUpperCase()} must be above entry price for a buy signal`,
        });
      }
    }
  } else {
    if (stop_loss <= entry_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stop_loss"],
        message: "Stop loss must be above entry price for a sell signal",
      });
    }
    for (const key of tps) {
      const tp = data[key];
      if (tp != null && tp >= entry_price) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key.toUpperCase()} must be below entry price for a sell signal`,
        });
      }
    }
  }
}

// Raw object (kept for .omit / .pick composition by callers that need it).
export const createSignalObjectSchema = z.object({
  trader_id: z.string().trim().min(1),
  instrument: z.string().trim().min(1).max(20),
  direction: z.enum(directions),
  entry_price: z.coerce.number().positive(),
  stop_loss: z.coerce.number().positive(),
  tp1: z.coerce.number().positive().nullable().optional(),
  tp2: z.coerce.number().positive().nullable().optional(),
  tp3: z.coerce.number().positive().nullable().optional(),
  tp4: z.coerce.number().positive().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(SIGNAL_STATUSES).default("CREATED"),
  risk_amount: z.coerce.number().positive().nullable().optional(),
});

export const createSignalSchema =
  createSignalObjectSchema.superRefine(refineSignalGeometry);

/** Form-side schema (no trader_id / status — they're injected server-side). */
export const createSignalFormSchema = createSignalObjectSchema
  .omit({ trader_id: true, status: true })
  .superRefine(refineSignalGeometry);

export const updateSignalStatusSchema = z.object({
  status: z.enum(SIGNAL_STATUSES),
});

export type CreateSignalInput = z.infer<typeof createSignalSchema>;
export type UpdateSignalStatusInput = z.infer<typeof updateSignalStatusSchema>;
