/**
 * What a reply in a signals room says happened to the trade it replies to.
 *
 * Different from the DM outcome parser on purpose. There, one message is one
 * verdict and two verdicts are a question for the person. Here nobody is
 * asked: a reply is a PROGRESS REPORT that may carry several facts at once
 * ("Tp3 hits with +200pips, Tp4 running +300pips", "TP1 HIT, TP2 HIT,
 * TP3 IN PROGRESS") and advice that is not a result at all ("You can
 * protect at BE", "Move SL to 4694", "Make trade risk free"). So this reads
 * every fact and leaves the arithmetic of what they mean for the trade to
 * the ingestion, which knows the trade's targets.
 *
 * Built from 6,553 exported messages across the four rooms; every pattern
 * below appears in them.
 */

import { PRICE, NOT_A_PRICE_AFTER, parsePrice } from "@/lib/trades/parse-price";

export interface ResultUpdate {
  /** Targets named as hit by index: "TP1 HIT", "Tp1 hits", "hit tp2". */
  readonly hits: readonly number[];
  /** Targets named as hit by PRICE with no index: "TP 65200 HIT", "TP HIT (4105)". */
  readonly hitPrices: readonly number[];
  /** "TP3 64000 ( +1000 pips )": a target line with a positive result and no verb. */
  readonly pricedHits: readonly { readonly index: number; readonly price: number; readonly pips: number }[];
  /** "SL HIT", "stopped out", "hit sl". Never a bare "SL" (that is advice). */
  readonly stopped: boolean;
  /** "Close first entry at BE", "closed at be", "be hit". Not "protect at BE". */
  readonly breakeven: boolean;
  /** "closed 4497", "out at 66000". */
  readonly closedAt: number | null;
  /** "running", "floating", "in progress", "still open": the runner is alive. */
  readonly running: boolean;
  /** The last "+N pips" written, for the record. Signed. */
  readonly pips: number | null;
}

const HIT_VERB = String.raw`(?:hits?|reached|done|taken|filled|achieved|smashed)`;

/** "TP1 HIT", "Tp 1 hits", "TP1 64000 HIT", "TP1: HIT", "TP1 ✅ HIT" (index required). */
const HIT_BY_INDEX_RE = new RegExp(
  String.raw`\btp\s*([1-7])\b\s*:?\s*(?:${PRICE}\s*)?(?:[^\w\n]{0,3}\s*)?${HIT_VERB}\b`,
  "gi",
);
/** "hit tp2", "took tp1", "reached tp3". */
const HIT_REVERSED_RE = new RegExp(String.raw`\b(?:hit|hits|took|reached|filled)\s+(?:the\s+)?tp\s*([1-7])\b`, "gi");
/** "TP 65200 HIT": a price between TP and the verb, no index. */
const HIT_BY_PRICE_RE = new RegExp(String.raw`\btp\s+(${PRICE})${NOT_A_PRICE_AFTER}\s*${HIT_VERB}\b`, "gi");
/** "TP HIT (4105)": the verb, then a bare price in brackets that is not a pips figure. */
const HIT_THEN_PRICE_RE = new RegExp(
  String.raw`\btp\s*(?:hit|hits)\s*\(\s*(${PRICE})\s*\)(?!\s*pips)`,
  "gi",
);
/** "TP3 64000 ( +1000 pips )": no verb; the positive result is the verb. */
const PRICED_LINE_RE = new RegExp(
  String.raw`\btp\s*([1-7])\s+(${PRICE})${NOT_A_PRICE_AFTER}\s*\(\s*\+\s*(\d+(?:[.,]\d+)?)\s*pips?\s*\)`,
  "gi",
);
const STOP_RE = /\b(?:sl|stop(?:\s*loss)?)\s+hit\b|\bstopped(?:\s+out)?\b(?!\s+(?:at\s+)?be\b)|\bhit\s+(?:the\s+|my\s+)?(?:sl|stop)\b|\btook\s+(?:the\s+)?loss\b/i;
const BREAKEVEN_RE =
  /\b(?:closed?|exit(?:ed)?|out|stopped)\b(?:\s+\w+){0,3}?\s+at\s+(?:be|breakeven|break\s?even)\b|\bbe\s+hit\b|\bclosed?\s+(?:at\s+)?(?:breakeven|break\s?even)\b|\bstopped\s+at\s+be\b/i;
const CLOSED_AT_RE = new RegExp(
  String.raw`\b(?:closed?|exit(?:ed)?|out)(?:\s+in\s+(?:profit|loss))?\s*(?:at|@|for|:)?\s*(${PRICE})${NOT_A_PRICE_AFTER}`,
  "i",
);
const RUNNING_RE = /\b(?:running|floating|in\s+progress|still\s+open|ongoing|still\s+in)\b/i;
const PIPS_RE = /([+-])\s*(\d+(?:[.,]\d+)?)\s*pips?\b/gi;

function all(re: RegExp, text: string): RegExpExecArray[] {
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

export function parseResultUpdate(input: string): ResultUpdate {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  const hits = new Set<number>();
  for (const m of all(HIT_BY_INDEX_RE, text)) hits.add(Number(m[1]));
  for (const m of all(HIT_REVERSED_RE, text)) hits.add(Number(m[1]));

  const hitPrices: number[] = [];
  for (const m of all(HIT_BY_PRICE_RE, text)) {
    const p = parsePrice(m[1]);
    if (p !== null) hitPrices.push(p);
  }
  for (const m of all(HIT_THEN_PRICE_RE, text)) {
    const p = parsePrice(m[1]);
    if (p !== null) hitPrices.push(p);
  }

  const pricedHits: { index: number; price: number; pips: number }[] = [];
  for (const m of all(PRICED_LINE_RE, text)) {
    const price = parsePrice(m[2]);
    const pips = parsePrice(m[3]);
    if (price !== null && pips !== null) pricedHits.push({ index: Number(m[1]), price, pips });
  }

  const closed = CLOSED_AT_RE.exec(text);
  const closedAt = closed ? parsePrice(closed[1]) : null;

  let pips: number | null = null;
  for (const m of all(PIPS_RE, text)) {
    const n = parsePrice(m[2]);
    if (n !== null) pips = m[1] === "-" ? -n : n;
  }

  return {
    hits: [...hits].sort((a, b) => a - b),
    hitPrices,
    pricedHits,
    stopped: STOP_RE.test(text),
    breakeven: BREAKEVEN_RE.test(text),
    closedAt,
    running: RUNNING_RE.test(text),
    pips,
  };
}

/** Whether the update carries any fact about the result at all. */
export function hasResult(u: ResultUpdate): boolean {
  return u.hits.length > 0 || u.hitPrices.length > 0 || u.pricedHits.length > 0 || u.stopped || u.breakeven || u.closedAt !== null;
}
