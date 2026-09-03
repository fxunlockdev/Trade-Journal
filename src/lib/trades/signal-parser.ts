/**
 * Parses a free-form signal message into structured trade fields.
 *
 * Goal: accept the wide variety of formats seen in Telegram / Discord
 * signal groups without forcing the user to clean them up first. The
 * parser is deliberately permissive — it extracts what it can recognize
 * and leaves the rest for the user to review in the form.
 *
 * Supported patterns (non-exhaustive):
 *   Buy XAUUSD 4819 SL 4823 TP 4830/4840/4850
 *   XAUUSD buy 3340 sl 3335 tp1 3350
 *   SELL EURUSD @ 1.0850 - 1.0860 SL: 1.0880 TP1 1.0820 TP2 1.0800 TP3 1.0780
 *   BUY GBPJPY NOW SL 190.50 TP1: 192.00 TP2: 193.00 TP3: 194.50 TP4: OPEN
 *   LONG BTCUSD entry 65000-65100 stop 64500 target 66000, 67000
 *
 * The parser returns a partial result — missing fields simply aren't
 * included — and a list of human-readable warnings for fields it
 * noticed but couldn't confidently map.
 *
 * What it will NOT do, because each of these once reached a poster as a
 * wrong number: read a time ("at 10:30") or a unit ("1.5 lots") as a price,
 * take an outcome verb's number as the entry ("closed at 3348"), pick a
 * direction when both a buy word and a sell word appear, or report one
 * instrument when two were named. Those are surfaced -- `direction_conflict`,
 * `instruments` -- for the caller to refuse on.
 */

import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { PRICE, NOT_A_PRICE_AFTER, parsePrice } from "@/lib/trades/parse-price";

export type ParsedDirection = "buy" | "sell";

export interface ParsedSignal {
  readonly instrument?: string;
  /** Every instrument named, in order of appearance. Two means two trades. */
  readonly instruments: readonly string[];
  readonly direction?: ParsedDirection;
  /** Both a buy word and a sell word appeared, so no direction was chosen. */
  readonly direction_conflict?: true;
  readonly entry_price?: number;
  readonly entry_price_high?: number;
  readonly stop_loss?: number;
  readonly tp1?: number;
  readonly tp2?: number;
  readonly tp3?: number;
  readonly tp4?: number;
  readonly tp5?: number;
  readonly tp6?: number;
  readonly tp7?: number;
  /** True when the final TP (tp4 historically, now tp7) is marked "open" or "runner". */
  readonly tp4_trailing?: boolean;
  /** "0.5 lots", when the message sized the trade. */
  readonly quantity?: number;
  readonly warnings: readonly string[];
}

const DIR_BUY_RE = /\b(?:buy|long|bull|bullish)\b/i;
const DIR_SELL_RE = /\b(?:sell|short|bear|bearish)\b/i;

/** A captured price with the "not a time, not a unit" guard. */
const PRICE_G = `(${PRICE})${NOT_A_PRICE_AFTER}`;
/** An entry range: "3340 - 3345", "1.0850/1.0860". */
const RANGE_G = `(${PRICE})\\s*[-/–]\\s*(${PRICE})${NOT_A_PRICE_AFTER}`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "XAUUSD" as a pattern that also matches "XAU/USD", "xau-usd", "BTC/USDT". */
function looseSymbol(symbol: string): string {
  return symbol.split("").map(escapeRe).join("[\\s/.\\-]?") + "[A-Z]{0,2}";
}

const SORTED_INSTRUMENTS = [...ALL_INSTRUMENTS].sort((a, b) => b.length - a.length);

/**
 * Every instrument named in the text, in order of first appearance.
 *
 * Longest symbols are matched first and a shorter symbol inside a longer
 * match is ignored, so "XAUUSD" does not also yield "XAU". Word boundaries
 * use a character class rather than \b, which does not treat "/" or "-" as
 * boundaries for pairs like "EUR/USD".
 */
export function findInstruments(text: string): string[] {
  const upper = text.toUpperCase();
  const spans: { sym: string; start: number; end: number }[] = [];
  for (const sym of SORTED_INSTRUMENTS) {
    const re = new RegExp(`(^|[^A-Z0-9])(${escapeRe(sym)})(?=[^A-Z0-9]|$)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(upper)) !== null) {
      const start = m.index + m[1].length;
      const end = start + sym.length;
      if (spans.some((s) => start >= s.start && end <= s.end)) continue;
      spans.push({ sym, start, end });
    }
  }
  if (spans.length === 0) {
    // Separators typed inside the symbol (EUR/USD, GBP-JPY): strip and retry.
    const normalized = upper.replace(/[\s/\-.]/g, "");
    const sym = SORTED_INSTRUMENTS.find((s) => normalized.includes(s));
    return sym ? [sym] : [];
  }
  const seen = new Set<string>();
  return spans
    .sort((a, b) => a.start - b.start)
    .map((s) => s.sym)
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

function findDirection(text: string): {
  readonly direction?: ParsedDirection;
  readonly conflict?: true;
} {
  const buy = DIR_BUY_RE.test(text);
  const sell = DIR_SELL_RE.test(text);
  // "XAUUSD sell 3340 ... long day" is not a buy. Choosing would be a guess
  // that flips the sign of the whole trade, so neither is chosen.
  if (buy && sell) return { conflict: true };
  if (buy) return { direction: "buy" };
  if (sell) return { direction: "sell" };
  return {};
}

const DIR = "(?:buy|sell|long|short)";
/**
 * An explicit entry marker. "at" counts, but NOT when it follows an outcome
 * verb: "out at 66000", "closed at 3348" and "stopped at 3332" are exits, and
 * reading them as entries publishes a trade with its result as its start.
 */
const MARKER = "(?:entry|@|(?<!\\b(?:closed?|exit(?:ed)?|out|stopped|hit|took)\\s+)at)";
/** "0.5 lots" between the direction and the price is a size, not the price. */
const LOT_SKIP = `(?:${PRICE}\\s*lots?\\s+)?`;

function readRange(m: RegExpMatchArray | null): { low: number; high: number } | null {
  if (!m) return null;
  const a = parsePrice(m[1]);
  const b = parsePrice(m[2]);
  if (a == null || b == null) return null;
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function readSingle(m: RegExpMatchArray | null): { low: number } | null {
  if (!m) return null;
  const a = parsePrice(m[1]);
  return a == null ? null : { low: a };
}

/**
 * The entry price.
 *
 * Anchored on the instrument first, in either order people type it --
 * "XAUUSD buy 3340" or "buy XAUUSD 3340", with an optional marker ("buy XAUUSD
 * at 3340") and an optional lot size in between. Then an explicit marker
 * anywhere ("entry 3340", "@ 3340"). The old lenient `<dir> <word> <number>`
 * form survives only for messages where no instrument was recognised, which
 * is the paste box in the trade form: for "XAUUSD buy closed 3348" it took
 * "closed" as the symbol and the exit as the entry.
 */
function findEntry(
  text: string,
  instrument?: string,
): { low?: number; high?: number } {
  if (instrument) {
    // The instrument may have been typed with separators anywhere -- "XAU/USD",
    // "USD/JPY", "BTC-USD" -- and with a quote suffix the catalogue does not
    // carry ("BTC/USDT"). Match the canonical symbol loosely rather than the
    // one spelling.
    const sym = looseSymbol(instrument);
    for (const head of [`${sym}\\s+${DIR}`, `${DIR}\\s+${sym}`]) {
      const lead = `${head}\\s+${LOT_SKIP}(?:${MARKER}\\s*:?\\s*)?`;
      const range = readRange(text.match(new RegExp(`${lead}${RANGE_G}`, "i")));
      if (range) return range;
      const single = readSingle(text.match(new RegExp(`${lead}${PRICE_G}`, "i")));
      if (single) return single;
    }
    // "buy 3340 xauusd": the price between the direction and the symbol.
    const between = readSingle(
      text.match(new RegExp(`${DIR}\\s+${LOT_SKIP}${PRICE_G}\\s+${sym}`, "i")),
    );
    if (between) return between;
  }

  const range = readRange(text.match(new RegExp(`${MARKER}\\s*:?\\s*${RANGE_G}`, "i")));
  if (range) return range;
  const single = readSingle(text.match(new RegExp(`${MARKER}\\s*:?\\s*${PRICE_G}`, "i")));
  if (single) return single;

  if (!instrument) {
    const fallback = readSingle(
      text.match(new RegExp(`${DIR}\\s+[A-Z0-9/.\\-]+\\s+${PRICE_G}`, "i")),
    );
    if (fallback) return fallback;
  }

  return {};
}

function findStop(text: string): number | undefined {
  // SL: 1.2345, SL 1.2345, stop loss 1.2345, stop 1.2345, S/L 1.2345, stop @ 190.50.
  // "sl moved to 3345" is a change to the plan, not the plan; it has no number
  // right after "sl" and so does not match.
  const re = new RegExp(
    `\\b(?:sl|s/l|stop\\s*loss|stop)\\s*:?\\s*(?:at\\s+|@\\s*)?${PRICE_G}`,
    "i",
  );
  const m = text.match(re);
  if (!m) return undefined;
  return parsePrice(m[1]) ?? undefined;
}

function findLotSize(text: string): number | undefined {
  const m = text.match(new RegExp(`(${PRICE})\\s*lots?\\b`, "i"));
  if (!m) return undefined;
  return parsePrice(m[1]) ?? undefined;
}

type ParsedTpKey = "tp1" | "tp2" | "tp3" | "tp4" | "tp5" | "tp6" | "tp7";

const MAX_TPS = 7;

/**
 * Collects TP prices. Handles up to 7 TPs (some signal groups use that many).
 *   TP 4830/4840/4850/4860/4870   → tp1..tp5
 *   TP1 4830 TP2 4840             → tp1, tp2
 *   target 66000, 67000           → tp1, tp2
 *   TP4: OPEN                     → tp4_trailing = true (no price)
 */
function findTps(text: string): {
  readonly tp1?: number;
  readonly tp2?: number;
  readonly tp3?: number;
  readonly tp4?: number;
  readonly tp5?: number;
  readonly tp6?: number;
  readonly tp7?: number;
  readonly tp4_trailing?: boolean;
} {
  const tps: Partial<Record<ParsedTpKey, number>> = {};
  let tp4Trailing = false;

  // Numbered TPs: TP1..TP7 with optional colon. "tp1 hit" yields no number
  // and is skipped, which is what keeps a result word out of the plan.
  const numberedRe = /tp\s*([1-7])\s*:?\s*([A-Z0-9.,\-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = numberedRe.exec(text)) !== null) {
    const idx = Number(match[1]);
    const raw = match[2];
    // Historically tp4 had trailing semantics; keep that flag wired up for
    // back-compat even though the form now supports tp5/6/7 too.
    if (idx === 4 && /open|running|runner|trail/i.test(raw)) {
      tp4Trailing = true;
      continue;
    }
    const n = parsePrice(raw);
    if (n != null && idx >= 1 && idx <= MAX_TPS) {
      const key = `tp${idx}` as ParsedTpKey;
      tps[key] = n;
    }
  }

  // If no numbered TPs found, try slashed or comma-separated list after TP/target.
  const anyFound = Object.values(tps).some((v) => v != null);
  if (!anyFound) {
    const listRe = new RegExp(
      `(?:tp|take\\s*profit|target|targets)\\s*:?\\s*((?:${PRICE})(?:\\s*[/,]\\s*(?:${PRICE}|open|running))*)`,
      "i",
    );
    const list = text.match(listRe);
    if (list) {
      // Split on "/" and on a comma that is a separator, not a thousands or
      // decimal comma: "4830/4840", "66000, 67000", but not "66,500".
      const parts = list[1].split(/\s*\/\s*|,\s+/).map((p) => p.trim());
      parts.forEach((part, i) => {
        if (i >= MAX_TPS) return;
        const key = `tp${i + 1}` as ParsedTpKey;
        if (/open|running|runner|trail/i.test(part)) {
          // "open" on the 4th slot preserves historical trailing semantics.
          if (i === 3) tp4Trailing = true;
          return;
        }
        const n = parsePrice(part);
        if (n != null) tps[key] = n;
      });
    }
  }

  return { ...tps, tp4_trailing: tp4Trailing || undefined };
}

export function parseSignalText(input: string): ParsedSignal {
  const text = input.trim();
  if (!text) return { instruments: [], warnings: [] };

  const warnings: string[] = [];

  const instruments = findInstruments(text);
  const instrument = instruments[0];
  if (!instrument) warnings.push("Could not identify instrument. Select it manually.");
  if (instruments.length > 1) {
    warnings.push(`More than one instrument named: ${instruments.join(", ")}.`);
  }

  const dir = findDirection(text);
  if (dir.conflict) warnings.push("Both a buy word and a sell word appear. Select BUY or SELL.");
  else if (!dir.direction) warnings.push("Could not identify direction. Select BUY or SELL.");

  const { low: entry_price, high: entry_price_high } = findEntry(text, instrument);
  if (entry_price == null) warnings.push("Could not identify entry price");

  const stop_loss = findStop(text);
  if (stop_loss == null) warnings.push("Could not identify stop loss");

  const tps = findTps(text);
  const hasAnyTp =
    tps.tp1 != null ||
    tps.tp2 != null ||
    tps.tp3 != null ||
    tps.tp4 != null ||
    tps.tp5 != null ||
    tps.tp6 != null ||
    tps.tp7 != null;
  if (!hasAnyTp && !tps.tp4_trailing) {
    warnings.push("Could not identify any take profit");
  }

  return {
    instrument,
    instruments,
    direction: dir.direction,
    direction_conflict: dir.conflict,
    entry_price,
    entry_price_high,
    stop_loss,
    tp1: tps.tp1,
    tp2: tps.tp2,
    tp3: tps.tp3,
    tp4: tps.tp4,
    tp5: tps.tp5,
    tp6: tps.tp6,
    tp7: tps.tp7,
    tp4_trailing: tps.tp4_trailing,
    quantity: findLotSize(text),
    warnings,
  };
}
