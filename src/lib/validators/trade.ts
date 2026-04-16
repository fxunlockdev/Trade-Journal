import { z } from "zod";

const assetTypes = ["forex", "crypto", "metal"] as const;
const directions = ["buy", "sell"] as const;
const sources = ["manual", "csv", "mt5_webhook"] as const;

export const createTradeSchema = z.object({
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

export const updateTradeSchema = createTradeSchema.partial();

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
