import { z } from "zod";

/**
 * Accept ISO-8601 or any other string `new Date(...)` can parse.
 * Zod's `.datetime()` is too strict — the model often emits
 * "2026-04-17 14:30" or "2026-04-17T14:30" (no timezone), which the DB
 * happily stores as a timestamptz, but .datetime() rejects. We validate
 * instead with `Date.parse` and reject only truly unparseable junk.
 */
const flexibleDatetime = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "entry_time must be a parseable date/time string",
  });

const tradeActionSchema = z.object({
  action: z.literal("create_trade"),
  data: z.object({
    instrument: z.string().min(1),
    asset_type: z.enum(["forex", "crypto", "metal"]),
    direction: z.enum(["buy", "sell"]),
    entry_price: z.coerce.number().positive(),
    exit_price: z.coerce.number().positive().nullable().optional(),
    quantity: z.coerce.number().positive().default(1),
    lot_size: z.coerce.number().positive().nullable().optional(),
    stop_loss: z.coerce.number().positive().nullable().optional(),
    take_profit: z.coerce.number().positive().nullable().optional(),
    fees: z.coerce.number().min(0).optional().default(0),
    entry_time: flexibleDatetime,
    exit_time: flexibleDatetime.nullable().optional(),
    notes: z.string().nullable().optional(),
    tags: z.string().nullable().optional(),
  }),
});

export type TradeAction = z.infer<typeof tradeActionSchema>;

function tryParseJSON(raw: string): TradeAction | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = tradeActionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Robust extractor — tries multiple strategies:
 * 1. ```json ... ``` or ``` ... ``` code fences
 * 2. Bare JSON object containing "create_trade"
 */
export function parseTradeAction(text: string): TradeAction | null {
  // Strategy 1: code fences (with or without json label)
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let m = fenceRe.exec(text);
  while (m) {
    const r = tryParseJSON(m[1].trim());
    if (r) return r;
    m = fenceRe.exec(text);
  }

  // Strategy 2: bare JSON object if it contains create_trade
  if (text.includes("create_trade")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const r = tryParseJSON(text.slice(start, end + 1));
      if (r) return r;
    }
  }

  return null;
}

/** Returns human-readable schema errors for debugging/logging */
export function getTradeParseErrors(text: string): string | null {
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  const m = fenceRe.exec(text);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[1].trim());
    const result = tradeActionSchema.safeParse(parsed);
    if (!result.success) {
      return result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" | ");
    }
  } catch {
    return "Invalid JSON in code block";
  }
  return null;
}
