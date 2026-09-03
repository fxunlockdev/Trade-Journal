/**
 * The one model call behind plain-words trade logging.
 *
 * Structured output against a strict JSON schema, temperature zero, short
 * timeout. Returns the parsed JSON or null; the caller validates it again
 * with zod and never trusts a field the schema did not name. Anything the
 * model cannot find is null, never a guess: the instructions say so, the
 * schema allows it, and the tests on prose.ts assume it.
 */

import { getOpenAIClient, OPENAI_MODEL, modelTuning } from "@/lib/openai/client";

export const PROSE_INSTRUCTIONS = `You extract ONE trade from a trader's message, written in any language, into JSON.
Rules:
- Only what is STATED. Never infer, estimate or round a number. Unknown = null.
- instrument: the broker symbol when obvious (gold -> XAUUSD, silver -> XAGUSD, oil/crude -> USOIL, nasdaq/nas -> NAS100, dow -> US30, spx -> SPX500, dax -> GER40, bitcoin/btc -> BTCUSD, eth -> ETHUSD, cable -> GBPUSD, fiber -> EURUSD, aussie -> AUDUSD, kiwi -> NZDUSD, EUR/USD -> EURUSD). Otherwise as written.
- direction: buy for bought/long/went long; sell for sold short/shorted/went short. "sold at X" after a buy is the EXIT, not the direction.
- entry: the fill price. entry_high only for a stated range.
- stop: the stop loss price. targets: take-profit prices in order.
- outcome.kind: closed_at when an exit price is given (put it in exit); tp_hit when a target was hit (tp_index); stopped when stopped out; breakeven when closed flat; open when still running; unknown otherwise.
- pnl: a stated result. pips (signed, negative for a loss), r (signed), money (signed) with currency when said. Do not convert between them.
- date: the day as written ("28 aug", "yesterday", "this morning", "3/9"); null if not said.
- lots: the size in lots if said. emotion: one of calm, confident, disciplined, neutral, excited, overconfident, anxious, fearful, greedy, fomo, revenge, frustrated if the message says how it felt; else null.
- notes: a short reason or comment worth keeping, in the writer's words; else null.
- is_trade: false for anything that is not a trade being reported. multiple_trades: true if more than one trade is described.`;

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_trade", "multiple_trades", "instrument", "direction", "entry", "entry_high", "stop", "targets", "outcome", "date", "lots", "pnl", "emotion", "notes"],
  properties: {
    is_trade: { type: "boolean" },
    multiple_trades: { type: "boolean" },
    instrument: { type: ["string", "null"] },
    direction: { type: ["string", "null"], description: "buy, sell, or null" },
    entry: { type: ["number", "null"] },
    entry_high: { type: ["number", "null"] },
    stop: { type: ["number", "null"] },
    targets: { type: "array", items: { type: "number" } },
    outcome: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "exit", "tp_index"],
      properties: {
        kind: { type: "string", enum: ["closed_at", "tp_hit", "stopped", "breakeven", "open", "unknown"] },
        exit: { type: ["number", "null"] },
        tp_index: { type: ["integer", "null"] },
      },
    },
    date: { type: ["string", "null"] },
    lots: { type: ["number", "null"] },
    pnl: {
      type: "object",
      additionalProperties: false,
      required: ["money", "currency", "pips", "r"],
      properties: {
        money: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        pips: { type: ["number", "null"] },
        r: { type: ["number", "null"] },
      },
    },
    emotion: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
} as const;

/** The JSON object in a model reply, with or without code fences around it. */
export function parseModelJson(text: string | null | undefined): unknown | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * The model's JSON for a message, or null when it could not be had.
 *
 * Structured output against the strict schema first. If the configured
 * model refuses the schema (a 400 about the format), one plain call asks for
 * the same JSON in text; zod on the way in makes the two equally safe.
 */
export async function extractTradeWithModel(text: string): Promise<unknown | null> {
  let client;
  try {
    client = getOpenAIClient();
  } catch (err: unknown) {
    console.error("[telegram/prose] model not configured:", err instanceof Error ? err.message : err);
    return null;
  }
  const base = {
    model: OPENAI_MODEL,
    instructions: PROSE_INSTRUCTIONS,
    input: [{ role: "user" as const, content: text }],
    ...modelTuning({ effort: "low", temperature: 0 }),
    max_output_tokens: 1500,
  };
  try {
    const response = await client.responses.create(
      {
        ...base,
        text: {
          format: {
            type: "json_schema",
            name: "trade_extraction",
            schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      },
      { timeout: 15_000 },
    );
    return parseModelJson(response.output_text);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const schemaRefused = /schema|format|response_format|json/i.test(message) && /400|invalid|unsupported/i.test(message);
    if (!schemaRefused) {
      console.error("[telegram/prose] model call failed:", message);
      return null;
    }
    console.error("[telegram/prose] structured output refused, retrying as text:", message);
  }
  try {
    const response = await client.responses.create(
      {
        ...base,
        instructions: `${PROSE_INSTRUCTIONS}\nRespond with ONLY the JSON object, no prose, no code fences, matching this schema exactly: ${JSON.stringify(EXTRACTION_JSON_SCHEMA)}`,
      },
      { timeout: 15_000 },
    );
    return parseModelJson(response.output_text);
  } catch (err: unknown) {
    console.error("[telegram/prose] model call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
