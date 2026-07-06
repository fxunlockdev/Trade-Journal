import { z } from "zod";

/**
 * MT5 connector payloads.
 *
 * Deliberately standalone — do NOT reuse createTradeSchema here: its
 * refineTradeGeometry rejects SLs on the profit side of entry, which is a
 * legitimate live-MT5 state after trailing/modification. The connector
 * mirrors whatever MT5 reports.
 */

/** One trade event from the EA. Times are unix SECONDS, already UTC. */
const mt5EventSchema = z
  .object({
    type: z.enum(["open", "update", "close"]),
    /** MT5 POSITION_IDENTIFIER / DEAL_POSITION_ID — stable across partials. */
    ticket: z.coerce.number().int().positive(),
    symbol: z.string().trim().min(1).max(32),
    direction: z.enum(["buy", "sell"]),
    /** Volume in lots. */
    volume: z.coerce.number().positive(),
    entry_price: z.coerce.number().positive(),
    sl: z.coerce.number().positive().nullable().optional(),
    tp: z.coerce.number().positive().nullable().optional(),
    open_time: z.coerce.number().int().positive(),
    /** Close-only fields — cumulative snapshots (see EA aggregation). */
    exit_price: z.coerce.number().positive().optional(),
    close_time: z.coerce.number().int().positive().optional(),
    profit: z.coerce.number().optional(),
    commission: z.coerce.number().optional(),
    swap: z.coerce.number().optional(),
    closed_volume: z.coerce.number().positive().optional(),
    /** True once the position no longer exists (fully closed). */
    is_final: z.coerce.boolean().optional(),
  })
  .superRefine((event, ctx) => {
    if (
      event.type === "close" &&
      (event.exit_price == null ||
        event.close_time == null ||
        event.profit == null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "close event requires exit_price, close_time and profit",
      });
    }
  });

export const mt5BatchSchema = z.object({
  /** MT5 account login number (stringified). */
  account: z.coerce.string().trim().min(1).max(32),
  /** ACCOUNT_SERVER, e.g. "ICMarketsSC-Demo". */
  server: z.string().trim().max(64).default(""),
  broker: z.string().trim().max(128).optional(),
  currency: z.string().trim().max(8).optional(),
  events: z.array(mt5EventSchema).min(1).max(50),
});

export const createMt5ConnectionSchema = z.object({
  journal_id: z.string().trim().uuid(),
  label: z.string().trim().max(80).nullable().optional(),
});

export type Mt5Event = z.infer<typeof mt5EventSchema>;
export type Mt5Batch = z.infer<typeof mt5BatchSchema>;
export type CreateMt5ConnectionInput = z.infer<
  typeof createMt5ConnectionSchema
>;
