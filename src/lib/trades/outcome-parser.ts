/**
 * Parses what HAPPENED to a trade out of a free-form message.
 *
 * `signal-parser.ts` reads the plan: instrument, direction, entry, stop,
 * targets. It says nothing about the result, because a signal is published
 * before there is one.
 *
 * That gap matters more than it sounds. The posters count only closed trades
 * carrying a P&L, so a trade ingested with no outcome is invisible to the
 * reporting this whole feature exists to feed. Someone would log a week of
 * trades and see nothing appear.
 *
 * Supported (non-exhaustive):
 *   closed 3348 / exit 3348 / out at 3348 / closed @ 3348
 *   tp1 hit / hit tp2 / tp3 reached / took tp1
 *   sl / stopped / stopped out / hit sl / stop hit
 *   be / breakeven / break even / closed at be
 *   still open / running / open
 *
 * DELIBERATELY NOT PERMISSIVE. Where signal-parser guesses generously and
 * leaves a human to correct it in a form, this one refuses: the result is what
 * gets published to partners, and an invented outcome is worse than no trade.
 * `kind: "unknown"` means "ask", never "assume".
 */

export type TpResult = "hit" | "be" | "sl";

export type ParsedOutcome =
  | {
      /** A price was given, so P&L can be computed exactly. */
      readonly kind: "closed_at";
      readonly exit_price: number;
      readonly note?: string;
    }
  | {
      /** No price, but a named result. `computeTradeFields` derives the exit
       *  from the TP or stop, which is why the trade needs those too. */
      readonly kind: "result";
      readonly result: TpResult;
      /** Which TP was hit, 1-based. Only meaningful when result is "hit". */
      readonly tpIndex?: number;
      readonly note?: string;
    }
  | { readonly kind: "still_open" }
  | { readonly kind: "unknown" };

/** Same numeric shape as signal-parser: accepts comma or dot decimals. */
const NUM = String.raw`\d+(?:[.,]\d+)?`;

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * An explicit exit price.
 *
 * The verb is required. Matching a bare number would swallow the entry, the
 * stop or a target, which is exactly how a parser silently invents a result.
 */
const CLOSED_AT_RE = new RegExp(
  String.raw`\b(?:closed?|exit(?:ed)?|out)\b[^\d\n]{0,12}(${NUM})`,
  "i",
);

/** "tp2 hit", "hit tp2", "tp2 reached", "took tp2", or a bare "tp2" as a result. */
const TP_HIT_RE =
  /\b(?:hit|took|reached|closed(?:\s+at)?)\s*tp\s*([1-7])\b|\btp\s*([1-7])\b[^\n]{0,12}?\b(?:hit|reached|done|closed)\b/i;

/** A stop-out. "sl 3335" is the PLAN, so a number after it disqualifies. */
const STOPPED_RE =
  /\b(?:stopped(?:\s+out)?|sl\s+hit|hit\s+sl|stop\s+hit|took\s+(?:the\s+)?loss)\b/i;

/** Bare "sl" or "stop" as a whole verdict, with no price following. */
const BARE_SL_RE = new RegExp(String.raw`\b(?:sl|stop)\b(?!\s*[:@]?\s*${NUM})`, "i");

const BREAKEVEN_RE = /\b(?:be|breakeven|break\s?even|scratched?)\b/i;

const STILL_OPEN_RE = /\b(?:still\s+open|running|in\s+profit|open\s+trade)\b/i;

/**
 * What happened, or "unknown".
 *
 * Order matters and encodes precedence: an explicit price beats a named
 * result, because a price is exact and a name is derived. A named TP beats a
 * bare stop mention, because "tp1 hit, sl moved to be" is a win.
 */
export function parseOutcome(input: string): ParsedOutcome {
  const text = (input ?? "").trim();
  if (!text) return { kind: "unknown" };

  const closed = CLOSED_AT_RE.exec(text);
  if (closed) {
    const price = toNumber(closed[1]);
    if (price !== null) return { kind: "closed_at", exit_price: price };
  }

  const tp = TP_HIT_RE.exec(text);
  if (tp) {
    const index = Number(tp[1] ?? tp[2]);
    if (index >= 1 && index <= 7) {
      return { kind: "result", result: "hit", tpIndex: index };
    }
  }

  // Breakeven before stop: "closed at be" and "sl to be" are both flat, and
  // both mention a stop.
  if (BREAKEVEN_RE.test(text)) return { kind: "result", result: "be" };

  if (STOPPED_RE.test(text)) return { kind: "result", result: "sl" };
  if (BARE_SL_RE.test(text)) return { kind: "result", result: "sl" };

  if (STILL_OPEN_RE.test(text)) return { kind: "still_open" };

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
