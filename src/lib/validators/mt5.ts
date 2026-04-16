import { z } from "zod";

const mt5TradeSchema = z.object({
  instrument: z.string().trim().min(1),
  type: z.enum(["buy", "sell"]),
  open_price: z.coerce.number().positive(),
  close_price: z.coerce.number().positive(),
  open_time: z.string().trim().min(1),
  close_time: z.string().trim().min(1),
  volume: z.coerce.number().positive(),
  commission: z.coerce.number(),
  swap: z.coerce.number(),
  profit: z.coerce.number(),
});

export const mt5WebhookSchema = z.object({
  secret: z.string().trim().min(1),
  trades: z.array(mt5TradeSchema).min(1),
});

export type Mt5WebhookPayload = z.infer<typeof mt5WebhookSchema>;
export type Mt5Trade = z.infer<typeof mt5TradeSchema>;
