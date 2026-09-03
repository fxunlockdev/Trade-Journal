/**
 * Parses what HAPPENED to a trade out of a free-form message.
 *
 * `signal-parser.ts` reads the plan: instrument, direction, entry, stop,
 * targets. It says nothing about the result, because a signal is published
 * before there is one.
 *
 * That gap matters more than it sounds. The posters count only closed trades
 * carrying a P&L, so a trade ingested with no outcome is invisible to the
 * reporting this whole feature exists to feed.
 *
 * Supported:
 *   closed 3348 / exit 3348 / out at 3348 / stopped at 3332
 *   tp1 hit / hit tp2 / tp3 reached / took tp1
 *   sl hit / stopped / stopped out / hit sl / a bare "sl" ENDING the message
 *   be / breakeven / closed at be / sl moved to be
 *   still open / running
 *
 * DELIBERATELY STRICT. The first version matched loosely -- a TP price within
 * twelve characters of "hit", the word "be" anywhere, "sl" anywhere without a
 * number after it -- and an adversarial pass turned every one of those into a
 * published loss shown as a win, or an open trade shown as a loss. So now a
 * result word must sit NEXT TO what it describes, "be" and "sl" alone count
 * only where a person would put a verdict (the end of the message or after a
 * closing verb), and when two different results are written the answer is
 * "ask", never "pick one". `kind: "unknown"` means ask, never assume.
 */

import { PRICE, NOT_A_PRICE_AFTER, parsePrice } from "./parse-price";

export type TpResult = "hit" | "be" | "sl";

export type ParsedOutcome =
  | {
      /** A price was given, so P&L can be computed exactly. */
      readonly kind: "closed_at";
      readonly exit_price: number;
    }
  | {
      /** No price, but a named result. `computeTradeFields` derives the exit
       *  from the TP or stop, which is why the trade needs those too. */
      readonly kind: "result";
      readonly result: TpResult;
      /** Which TP was hit, 1-based. Only meaningful when result is "hit". */
      readonly tpIndex?: number;
    }
  | { readonly kind: "still_open" }
  | { readonly kind: "unknown"; readonly reason?: string };

/**
 * An explicit exit price: a closing verb, an optional "at", the number.
 *
 * "stopped at 3332" is here rather than under the stop-out words because it
 * carries the exact price, which beats deriving one from the planned stop.
 * The price must pass NOT_A_PRICE_AFTER, so "closed +80 pips" and "closed at
 * 10:30" yield nothing (the "+" is not part of a price token either).
 */
const CLOSED_AT_RE = new RegExp(
  String.raw`\b(?:closed?|exit(?:ed)?|out|stopped(?:\s+out)?)(?:\s+in\s+(?:profit|loss))?\s*(?:at|@|for|:)?\s*(${PRICE})${NOT_A_PRICE_AFTER}`,
  "i",
);

/**
 * A TP that was hit. The index must be IMMEDIATELY beside the verb: "tp1 hit",
 * "hit tp2". "tp1 3350 sl hit" therefore does not match here, and "sl hit"
 * does. A bare "tp hit" is TP1.
 */
const TP_HIT_RE =
  /\btp\s*([1-7])?\s*:?\s*(?:(?:hit|reached|done|taken|filled)\b|✅)|\b(?:hit|took|reached|filled)\s+(?:the\s+)?tp\s*([1-7])?\b/i;

/**
 * A stop-out. Either a result verb next to the stop ("sl hit", "stopped out",
 * "took the loss"), or a bare "sl"/"stop" that ENDS the message, which is how
 * "XAUUSD buy 3340 sl 3335 tp1 3350 sl" reads. "sl 3335" is the plan and "sl
 * moved to 3345" is a change to it; neither is a verdict.
 */
const STOP_OUT_RE =
  /\bstopped(?:\s+out)?\b(?!\s+(?:at\s+)?be\b)|\b(?:sl|stop(?:\s*loss)?)\s+(?:hit|taken|triggered)\b|\bhit\s+(?:the\s+|my\s+)?(?:sl|stop)\b|\btook\s+(?:the\s+)?loss\b|\b(?:sl|stop)\s*[.!]?\s*$/i;

/**
 * Breakeven. The full words anywhere; the abbreviation "be" only where a
 * verdict goes -- after a closing verb ("closed at be", "sl moved to be"), or
 * as the last word of a clause -- because "be" is also the commonest verb in
 * English and "should be better next time" is not a scratch.
 */
const BREAKEVEN_RE =
  /\b(?:breakeven|break-?\s?even|b\/e|scratch(?:ed)?)\b|\b(?:closed|out|exit(?:ed)?|stopped|moved|to|at|hit)\s+(?:at\s+)?be\b|\bbe\s+hit\b|\bbe\b(?=\s*(?:[.!,;]|$))/i;

const STILL_OPEN_RE =
  /\b(?:still\s+open|running|runner|open\s+trade|not\s+closed|ongoing|still\s+in)\b/i;

/** A partial close is two outcomes in one message; one row cannot hold it. */
const PARTIAL_RE = /\b(?:half|partial(?:ly)?)\b/i;

const RESULT_WORDS: Record<TpResult, string> = {
  hit: "a TP hit",
  sl: "stopped out",
  be: "breakeven",
};

/**
 * What happened, or "unknown".
 *
 * An explicit price beats a named result, because a price is exact and a name
 * is derived: "tp1 hit, closed 3348" is a close at 3348. Beyond that, two
 * different results in one message are a question, not a choice.
 */
export function parseOutcome(input: string): ParsedOutcome {
  const text = (input ?? "").trim();
  if (!text) return { kind: "unknown" };

  if (PARTIAL_RE.test(text)) {
    return {
      kind: "unknown",
      reason: "a partial close can't be logged as one trade; give the final exit",
    };
  }

  const open = STILL_OPEN_RE.test(text);

  const closed = CLOSED_AT_RE.exec(text);
  const exit = closed ? parsePrice(closed[1]) : null;
  if (exit !== null) {
    if (open) return { kind: "unknown", reason: "it says both closed and still open" };
    return { kind: "closed_at", exit_price: exit };
  }

  const results: Extract<ParsedOutcome, { kind: "result" }>[] = [];
  const tp = TP_HIT_RE.exec(text);
  if (tp) {
    const index = Number(tp[1] ?? tp[2] ?? 1);
    results.push({ kind: "result", result: "hit", tpIndex: index });
  }
  if (BREAKEVEN_RE.test(text)) results.push({ kind: "result", result: "be" });
  if (STOP_OUT_RE.test(text)) results.push({ kind: "result", result: "sl" });

  if (results.length > 1 || (results.length === 1 && open)) {
    const seen = [
      ...results.map((r) => RESULT_WORDS[r.result]),
      ...(open ? ["still open"] : []),
    ];
    return {
      kind: "unknown",
      reason: `it says more than one result (${seen.join(", ")}); tell me one`,
    };
  }
  if (results.length === 1) return results[0];
  if (open) return { kind: "still_open" };
  return { kind: "unknown" };
}

/**
 * Which `tpN_result` column a parsed outcome writes, if any.
 *
 * Setting ANY tp result flips `computeTradeFields` into its multi-TP path,
 * where the exit price is derived from the TP prices rather than taken as
 * given. So a result is only ever written on the slot it actually refers to,
 * and a "closed at" outcome writes none: it already has a real exit.
 */
export function outcomeFields(
  outcome: ParsedOutcome,
): Record<string, number | string | null> {
  if (outcome.kind === "closed_at") {
    return { exit_price: outcome.exit_price };
  }
  if (outcome.kind === "result") {
    // A stop or a breakeven is recorded on tp1: it is the trade's verdict, not
    // a statement about the second target.
    const slot = outcome.result === "hit" ? (outcome.tpIndex ?? 1) : 1;
    return { [`tp${slot}_result`]: outcome.result };
  }
  return {};
}

/** Whether this outcome makes the trade countable by the reports. */
export function isClosedOutcome(outcome: ParsedOutcome): boolean {
  return outcome.kind === "closed_at" || outcome.kind === "result";
}
