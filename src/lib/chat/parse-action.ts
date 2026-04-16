import { z } from "zod";

const tradeActionSchema = z.object({
  action: z.literal("create_trade"),
  data: z.object({
    instrument: z.string().min(1),
    asset_type: z.enum(["forex", "crypto", "metal"]),
    direction: z.enum(["buy", "sell"]),
    entry_price: z.coerce.number().positive(),
    exit_price: z.coerce.number().positive().nullable().optional(),
    quantity: z.coerce.number().positive(),
    lot_size: z.coerce.number().positive().nullable().optional(),
    stop_loss: z.coerce.number().positive().nullable().optional(),
    take_profit: z.coerce.number().positive().nullable().optional(),
    fees: z.coerce.number().min(0).optional().default(0),
    entry_time: z.string().min(1),
    exit_time: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    tags: z.string().nullable().optional(),
  }),
});

export type TradeAction = z.infer<typeof tradeActionSchema>;

/**
 * Extracts a JSON action block from the AI response text.
 * Returns the parsed action if found and valid, or null otherwise.
 */
export function parseTradeAction(text: string): TradeAction | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/;
  const match = jsonBlockRegex.exec(text);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    const result = tradeActionSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    return null;
  } catch {
    return null;
  }
}
