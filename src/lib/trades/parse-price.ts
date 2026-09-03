/**
 * One number parser for every trade parser.
 *
 * There were two, and they disagreed in ways that reached the posters: one
 * accepted a negative price, the other dropped the sign; both replaced the
 * first comma with a dot, so "66,500" was sixty-six and a half and a BTC trade
 * saved with an entry of 65. A price is positive, and a comma is a thousands
 * separator when it is followed by exactly three digits and a decimal point
 * or nothing, and a decimal comma otherwise ("1,0850" is how a European desk
 * writes EURUSD).
 */

/** A price token, for building regexes: "3340", "1.0850", "1,0850", "66,500", "1,234.5". */
export const PRICE = String.raw`\d+(?:,\d{3})*(?:[.,]\d+)?`;

/**
 * What must NOT follow a price token for it to be a price: more digits (the
 * token was cut short), a time ("10:30"), or a unit. Appended to every regex
 * that captures a price, so "1.5 lots", "+80 pips", "risk 1.2%" and "at 10:30"
 * never yield a number.
 */
export const NOT_A_PRICE_AFTER = String.raw`(?![.,]?\d|\s*(?::\d|%|pips?\b|pts?\b|points?\b|lots?\b|r\b|am\b|pm\b))`;

/** A positive number, or null. A leading "+" is tolerated; a "-" is refused. */
export function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(/^\+/, "");
  if (!s || s.startsWith("-")) return null;
  let n: number;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) {
    n = Number(s.replace(/,/g, ""));
  } else if (/^\d+,\d+$/.test(s)) {
    n = Number(s.replace(",", "."));
  } else if (/^\d+(?:\.\d+)?$/.test(s)) {
    n = Number(s);
  } else {
    return null;
  }
  return Number.isFinite(n) && n > 0 ? n : null;
}
