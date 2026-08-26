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
 *   SELL EURUSD @ 1.0850 - 1.0860 SL: 1.0880 TP1 1.0820 TP2 1.0800 TP3 1.0780
 *   BUY GBPJPY NOW SL 190.50 TP1: 192.00 TP2: 193.00 TP3: 194.50 TP4: OPEN
 *   LONG BTCUSD entry 65000-65100 stop 64500 target 66000, 67000
 *
 * The parser returns a partial result — missing fields simply aren't
 * included — and a list of human-readable warnings for fields it
 * noticed but couldn't confidently map.
 */

import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";

export type ParsedDirection = "buy" | "sell";

export interface ParsedSignal {
  readonly instrument?: string;
  readonly direction?: ParsedDirection;
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
  readonly warnings: readonly string[];
}

const DIR_BUY_RE = /\b(buy|long|bull|bullish)\b/i;
const DIR_SELL_RE = /\b(sell|short|bear|bearish)\b/i;

/**
 * Match a decimal number — supports both "1,2345" (comma decimal) and
 * "1.2345" (dot decimal). We normalize to dot at extraction time.
 */
const NUM_RE = /-?\d+(?:[.,]\d+)?/;

function toNumber(raw: string): number | null {
  const normalized = raw.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function findInstrument(text: string): string | undefined {
  const upper = text.toUpperCase();
  // Prefer longer matches first so "XAUUSD" wins over "AU" if both present.
  const sorted = [...ALL_INSTRUMENTS].sort((a, b) => b.length - a.length);
  for (const sym of sorted) {
    // Word-boundary match using a char class that treats non-alphanumeric as a
    // boundary. \b won't catch "/" or "-" cleanly for pairs like "EUR/USD".
    const re = new RegExp(`(^|[^A-Z0-9])${sym}([^A-Z0-9]|$)`);
    if (re.test(upper)) return sym;
  }
  // Try stripping common separators (EUR/USD, GBP-JPY) and retrying.
  const normalized = upper.replace(/[\s/\-.]/g, "");
  for (const sym of sorted) {
    if (normalized.includes(sym)) return sym;
  }
  return undefined;
}

function findDirection(text: string): ParsedDirection | undefined {
  if (DIR_BUY_RE.test(text)) return "buy";
  if (DIR_SELL_RE.test(text)) return "sell";
  return undefined;
}

/**
 * Extract the entry price(s). Handles:
 *   "entry 1.2345", "@ 1.2345", "at 1.2345"
 *   range "1.2345 - 1.2355", "1.2345/1.2355"
 *   bare price right after BUY/SELL: "BUY XAUUSD 1950" — last resort
 */
function findEntry(text: string): { low?: number; high?: number } {
  // Prefer an explicit "entry" / "@" / "at" marker.
  const rangeRe = new RegExp(
    `(?:entry|@|at)\\s*:?\\s*(${NUM_RE.source})\\s*[-/–]\\s*(${NUM_RE.source})`,
    "i",
  );
  const range = text.match(rangeRe);
  if (range) {
    const a = toNumber(range[1]);
    const b = toNumber(range[2]);
    if (a != null && b != null) {
      return a <= b ? { low: a, high: b } : { low: b, high: a };
    }
  }

  const singleRe = new RegExp(
    `(?:entry|@|at)\\s*:?\\s*(${NUM_RE.source})`,
    "i",
  );
  const single = text.match(singleRe);
  if (single) {
    const a = toNumber(single[1]);
    if (a != null) return { low: a };
  }

  // Fallback: "BUY XAUUSD 1950" — first bare number after direction + symbol.
  const dirSymNumRe = new RegExp(
    `(?:buy|sell|long|short)\\s+[A-Z0-9/.\\-]+\\s+(${NUM_RE.source})`,
    "i",
  );
  const fallback = text.match(dirSymNumRe);
  if (fallback) {
    const a = toNumber(fallback[1]);
    if (a != null) return { low: a };
  }

  return {};
}

function findStop(text: string): number | undefined {
  // SL: 1.2345, SL 1.2345, stop loss 1.2345, stop 1.2345, S/L 1.2345
  const re = new RegExp(
    `(?:sl|s/l|stop\\s*loss|stop)\\s*:?\\s*(${NUM_RE.source})`,
    "i",
  );
  const m = text.match(re);
  if (!m) return undefined;
  return toNumber(m[1]) ?? undefined;
}

type ParsedTpKey =
  | "tp1"
  | "tp2"
  | "tp3"
  | "tp4"
  | "tp5"
  | "tp6"
  | "tp7";

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

  // Numbered TPs: TP1..TP7 with optional colon.
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
    const n = toNumber(raw);
    if (n != null && idx >= 1 && idx <= MAX_TPS) {
      const key = `tp${idx}` as ParsedTpKey;
      tps[key] = n;
    }
  }

  // If no numbered TPs found, try slashed or comma-separated list after TP/target.
  const anyFound = Object.values(tps).some((v) => v != null);
  if (!anyFound) {
    const listRe = new RegExp(
      `(?:tp|take\\s*profit|target|targets)\\s*:?\\s*((?:${NUM_RE.source})(?:\\s*[/,]\\s*(?:${NUM_RE.source}|open|running))*)`,
      "i",
    );
    const list = text.match(listRe);
    if (list) {
      const parts = list[1].split(/[/,]/).map((p) => p.trim());
      parts.forEach((part, i) => {
        if (i >= MAX_TPS) return;
        const key = `tp${i + 1}` as ParsedTpKey;
        if (/open|running|runner|trail/i.test(part)) {
          // "open" on the 4th slot preserves historical trailing semantics.
          if (i === 3) tp4Trailing = true;
          return;
        }
        const n = toNumber(part);
        if (n != null) tps[key] = n;
      });
    }
  }

  return { ...tps, tp4_trailing: tp4Trailing || undefined };
}

export function parseSignalText(input: string): ParsedSignal {
  const text = input.trim();
  if (!text) return { warnings: [] };

  const warnings: string[] = [];

  const instrument = findInstrument(text);
  if (!instrument) warnings.push("Could not identify instrument. Select it manually.");

  const direction = findDirection(text);
  if (!direction) warnings.push("Could not identify direction. Select BUY or SELL.");

  const { low: entry_price, high: entry_price_high } = findEntry(text);
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
    direction,
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
    warnings,
  };
}
