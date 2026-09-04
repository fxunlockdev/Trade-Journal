/**
 * Reading a trade written in plain words.
 *
 * "Bought gold at 3340 this morning, stop 3335, closed it at 3348 for a quick
 * 80 pips." The strict grammar cannot read that, and it should not try: a
 * grammar loose enough for prose is how wrong numbers reach posters. So a
 * model turns the prose into a small JSON of what was STATED, and this module
 * renders that JSON into the grammar's own canonical line and parses it with
 * the same parser, the same checks, the same summary and the same questions
 * as a typed trade. The model never writes a field; it only translates.
 *
 * A stated result ("made 80 pips", "+2R", "made $400") becomes the exit
 * price when none was given, worked out from the entry and the instrument,
 * and is checked against the prices when one was: a disagreement is shown,
 * not hidden.
 *
 * Pure. The model call lives in prose-model.ts behind a function the store
 * provides, so every branch here is a unit test with fixture JSON.
 */

import { z } from "zod";
import { parseTradeIntent, describeDraft, type TradeIntent, type TradeDraft } from "@/lib/telegram/trade-intent";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { findInstruments } from "@/lib/trades/signal-parser";
import { expandAliases, mentionsAlias } from "@/lib/trades/instrument-aliases";
import { EMOTION_VALUES, type EmotionState } from "@/lib/constants/emotions";
import type { Answers } from "@/lib/telegram/conversation";

/** The currency a price is quoted in, from the symbol. Money can only be
 *  turned into a price when that is USD; the rest would need a rate. */
const INDEX_QUOTE: Record<string, string> = {
  US30: "USD", NAS100: "USD", SPX500: "USD", USOIL: "USD", UKOIL: "USD", NATGAS: "USD",
  COPPER: "USD", CORN: "USD", WHEAT: "USD", GER40: "EUR", FRA40: "EUR", ESP35: "EUR",
  UK100: "GBP", JPN225: "JPY", AUS200: "AUD", HK50: "HKD",
};
export function quoteCurrency(instrument: string): string | null {
  if (INDEX_QUOTE[instrument]) return INDEX_QUOTE[instrument];
  const m = /^[A-Z]{3,4}(USDT|USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|BTC)$/.exec(instrument);
  return m ? (m[1] === "USDT" ? "USD" : m[1]) : null;
}

const num = z.number().finite();
const positive = num.positive();

/** What the model may say. Anything else is refused, not repaired. */
export const extractionSchema = z.object({
  is_trade: z.boolean(),
  multiple_trades: z.boolean(),
  instrument: z.string().max(30).nullable(),
  direction: z.enum(["buy", "sell"]).nullable(),
  entry: positive.nullable(),
  entry_high: positive.nullable(),
  stop: positive.nullable(),
  targets: z.array(positive).max(7),
  outcome: z.object({
    kind: z.enum(["closed_at", "tp_hit", "stopped", "breakeven", "open", "unknown"]),
    exit: positive.nullable(),
    tp_index: z.number().int().min(1).max(7).nullable(),
  }),
  date: z.string().max(40).nullable(),
  lots: positive.max(1000).nullable(),
  pnl: z.object({
    money: num.nullable(),
    currency: z.string().max(5).nullable(),
    pips: num.nullable(),
    r: num.nullable(),
  }),
  emotion: z.string().max(20).nullable(),
  notes: z.string().max(1000).nullable(),
});

export type Extraction = z.infer<typeof extractionSchema>;

/**
 * Whether a message the grammar could not read is worth sending to the
 * model: a number, a trade verb, and an instrument by symbol or by name.
 * "Bought gold at 3340" yes; "thanks" no; "calm" no.
 */
export function looksLikeProseTrade(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (!/\b(?:bought|sold|buy|sell|long(?:ed)?|short(?:ed)?|entered|took|closed|stopped|scalped|traded|went)\b/i.test(text)) {
    return false;
  }
  return mentionsAlias(text) || findInstruments(expandAliases(text)).length > 0;
}

/** Words for the day that the date parser does not know but people use. */
const DAY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/^(?:this\s+(?:morning|afternoon|evening)|tonight|earlier(?:\s+today)?|just\s+now|today)$/i, "today"],
  [/^(?:last\s+night|yesterday(?:\s+\w+)?)$/i, "yesterday"],
];

function dayWord(date: string | null): string | null {
  if (!date) return null;
  const t = date.trim();
  for (const [re, word] of DAY_WORDS) if (re.test(t)) return word;
  return t;
}

/** The instrument the model named, as a catalogue symbol, or null. */
function resolveInstrument(raw: string | null): string | null {
  if (!raw) return null;
  const found = findInstruments(expandAliases(raw));
  return found.length === 1 ? found[0] : null;
}

function roundToTick(price: number, instrument: string): number {
  const { tickSize } = getInstrumentSpec(instrument);
  const decimals = Math.max(0, Math.ceil(-Math.log10(tickSize)));
  return Number(price.toFixed(decimals));
}

/**
 * The exit price a stated result implies, when no exit was given.
 * Pips and R are exact; money needs the size and a USD-quoted instrument.
 */
export function deriveExit(
  x: Extraction,
  instrument: string,
  direction: "buy" | "sell",
  entry: number,
): { exit: number; from: string } | null {
  const sign = direction === "buy" ? 1 : -1;
  const spec = getInstrumentSpec(instrument);
  if (x.pnl.pips !== null) {
    return { exit: roundToTick(entry + sign * x.pnl.pips * spec.pipSize, instrument), from: `${signed(x.pnl.pips)} pips` };
  }
  if (x.pnl.r !== null && x.stop !== null) {
    const risk = Math.abs(entry - x.stop);
    return { exit: roundToTick(entry + sign * x.pnl.r * risk, instrument), from: `${signed(x.pnl.r)}R` };
  }
  if (x.pnl.money !== null && x.lots !== null && (x.pnl.currency === null || x.pnl.currency.toUpperCase() === "USD") && quoteCurrency(instrument) === "USD") {
    const perPoint = x.lots * spec.contractSize;
    if (perPoint > 0) {
      return { exit: roundToTick(entry + (sign * x.pnl.money) / perPoint, instrument), from: `${signed(x.pnl.money)} USD at ${x.lots} lots` };
    }
  }
  return null;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${Number(n.toFixed(2))}`;
}

/**
 * Where a stated result disagrees with the prices, in words. Shown under the
 * summary; the person decides which is wrong.
 */
export function pnlWarnings(
  x: Extraction,
  instrument: string,
  direction: "buy" | "sell",
  entry: number,
  exit: number,
): string[] {
  const out: string[] = [];
  const sign = direction === "buy" ? 1 : -1;
  const spec = getInstrumentSpec(instrument);
  const movePips = (sign * (exit - entry)) / spec.pipSize;
  if (x.pnl.pips !== null && Math.abs(movePips - x.pnl.pips) > Math.max(1, Math.abs(x.pnl.pips) * 0.05)) {
    out.push(`you said ${signed(x.pnl.pips)} pips, but ${entry} to ${exit} is ${signed(movePips)} pips`);
  }
  if (x.pnl.r !== null && x.stop !== null) {
    const risk = Math.abs(entry - x.stop);
    const r = risk > 0 ? (sign * (exit - entry)) / risk : 0;
    if (Math.abs(r - x.pnl.r) > Math.max(0.1, Math.abs(x.pnl.r) * 0.1)) {
      out.push(`you said ${signed(x.pnl.r)}R, but with the stop at ${x.stop} it is ${signed(r)}R`);
    }
  }
  if (
    x.pnl.money !== null && x.lots !== null && quoteCurrency(instrument) === "USD" &&
    (x.pnl.currency === null || x.pnl.currency.toUpperCase() === "USD")
  ) {
    const money = sign * (exit - entry) * x.lots * spec.contractSize;
    if (Math.abs(money - x.pnl.money) > Math.max(1, Math.abs(x.pnl.money) * 0.05)) {
      out.push(`you said ${signed(x.pnl.money)} USD, but ${entry} to ${exit} at ${x.lots} lots is ${signed(money)} USD`);
    }
  }
  return out;
}

/**
 * The grammar's own line for what the model extracted. Built here, never by
 * the model, so nothing but numbers and known words reach the parser.
 */
export function renderCanonical(x: Extraction, instrument: string, exit: number | null): string {
  const parts: string[] = [instrument, x.direction ?? ""];
  if (x.entry !== null) parts.push(x.entry_high !== null ? `${x.entry}-${x.entry_high}` : String(x.entry));
  if (x.stop !== null) parts.push(`sl ${x.stop}`);
  x.targets.forEach((t, i) => parts.push(`tp${i + 1} ${t}`));
  if (exit !== null) parts.push(`closed ${exit}`);
  else if (x.outcome.kind === "tp_hit") parts.push(`tp${x.outcome.tp_index ?? 1} hit`);
  else if (x.outcome.kind === "stopped") parts.push("sl hit");
  else if (x.outcome.kind === "breakeven") parts.push("closed at be");
  else if (x.outcome.kind === "open") parts.push("still open");
  if (x.lots !== null) parts.push(`${x.lots} lots`);
  const day = dayWord(x.date);
  if (day) parts.push(day === "today" || day === "yesterday" ? day : `on ${day}`);
  return parts.filter(Boolean).join(" ");
}

export interface ProseReading {
  readonly intent: TradeIntent;
  /** Answers the prose already gave, so those questions are not asked. */
  readonly prefill: Answers;
}

/**
 * Turn the model's JSON into the same intent a typed trade produces.
 *
 * Refuses (as "incomplete", in words) what the grammar would refuse, plus
 * two things only prose can do: describe two trades, and state a result
 * that cannot be turned into a price.
 */
/**
 * A result is only "stated" if the message contains the words for it. The
 * model was told not to compute one, and still did (3348 - 3340 = "8 pips",
 * then flagged against the real 80), so nothing it reports about the result
 * survives without evidence in the text: pips need "pips" or "points", R
 * needs an R, money needs a currency sign or a word like made/lost/profit.
 */
export function statedOnly(x: Extraction, text: string): Extraction {
  const t = text.toLowerCase();
  const saysPips = /\b(?:pips?|pts?|points?)\b/.test(t);
  const saysR = /\b\d+(?:[.,]\d+)?\s*r\b|\br\s*multiple\b/i.test(text);
  const currency = /[$€£]|\b(?:usd|eur|gbp|dollars?|bucks|quid|euros?|pounds?)\b/.test(t);
  // "made 80 pips" is pips; "made 400" with no unit is money.
  const verbNumber = /\b(?:made|lost|profit|loss|gain(?:ed)?|banked|took)\b\s*(?:a\s+|of\s+|about\s+|around\s+)?[$€£]?\d[\d.,]*(?![\d.,]*\s*(?:pips?|pts?|points?|r)\b)/.test(t);
  const saysMoney = currency || verbNumber;
  return {
    ...x,
    pnl: {
      pips: saysPips ? x.pnl.pips : null,
      r: saysR ? x.pnl.r : null,
      money: saysMoney ? x.pnl.money : null,
      currency: saysMoney ? x.pnl.currency : null,
    },
  };
}

export function readExtraction(raw: unknown, original: string, now: Date): ProseReading | null {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const x = statedOnly(parsed.data, original);
  if (!x.is_trade) return null;
  if (x.multiple_trades) {
    return { intent: { kind: "incomplete", missing: ["one trade per message: that reads like more than one"] }, prefill: {} };
  }

  const instrument = resolveInstrument(x.instrument);
  const missing: string[] = [];
  if (!instrument) missing.push(x.instrument ? `an instrument I know (I read "${x.instrument}")` : "the instrument (e.g. XAUUSD, or just gold)");
  if (!x.direction) missing.push("buy or sell");
  if (x.entry === null) missing.push("the entry price");
  if (missing.length > 0 || !instrument || !x.direction || x.entry === null) {
    return { intent: { kind: "incomplete", missing }, prefill: {} };
  }

  let exit: number | null = x.outcome.kind === "closed_at" ? x.outcome.exit : null;
  let derivedFrom: string | null = null;
  const statedResult = x.pnl.pips !== null || x.pnl.r !== null || x.pnl.money !== null;
  if (exit === null && x.outcome.kind === "unknown" && statedResult) {
    const d = deriveExit(x, instrument, x.direction, x.entry);
    if (d) {
      exit = d.exit;
      derivedFrom = d.from;
    } else if (x.pnl.money !== null) {
      return {
        intent: {
          kind: "incomplete",
          missing: [
            x.lots === null
              ? `the size in lots or the exit price, so ${signed(x.pnl.money)} ${x.pnl.currency ?? "USD"} can be turned into an exit`
              : `the exit price or the result in pips: I can't turn ${signed(x.pnl.money)} ${x.pnl.currency ?? "USD"} into a price for ${instrument}`,
          ],
        },
        prefill: {},
      };
    } else if (x.pnl.r !== null) {
      return { intent: { kind: "incomplete", missing: ["the stop loss, so the R can be turned into an exit"] }, prefill: {} };
    }
  }

  const line = renderCanonical(x, instrument, exit);
  const intent = parseTradeIntent(line, now);
  if (intent.kind !== "ready") return { intent, prefill: {} };

  const warnings = exit !== null && derivedFrom === null ? pnlWarnings(x, instrument, x.direction, x.entry, exit) : [];
  const draft: TradeDraft = {
    ...intent.draft,
    message: original,
    read_from_prose: true,
    derived_exit: derivedFrom,
    warnings,
  };

  const emotion = x.emotion ? EMOTION_VALUES.find((e) => e === x.emotion!.toLowerCase()) : undefined;
  const prefill: Answers = {
    ...(emotion ? { emotion: emotion as EmotionState } : {}),
    ...(x.notes && x.notes.trim() ? { notes: x.notes.trim() } : {}),
  };

  // Summarised again with the provenance note and the warnings on it.
  return { intent: { kind: "ready", draft, summary: describeDraft(draft) }, prefill };
}
