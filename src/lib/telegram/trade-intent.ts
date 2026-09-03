/**
 * Turn a typed message into something a person can confirm.
 *
 * Composes the three parsers that already exist -- the plan (signal-parser),
 * the result (outcome-parser) and the date (trade-date) -- into one draft, and
 * says in plain words either what it understood or what it still needs.
 *
 * Pure. Everything here is testable without a bot, and nothing here writes.
 * The rule this module enforces: NOTHING IS SAVED WITHOUT A PERSON SEEING IT
 * FIRST. Free text is where this kind of feature goes wrong, and the summary
 * is the only defence -- so anything the summary could show as a plausible
 * wrong number is refused here instead, in words: a stop on the wrong side,
 * an exit that cannot be this instrument's price, two trades in one message,
 * a date in the future.
 */

import { parseSignalText } from "@/lib/trades/signal-parser";
import {
  parseOutcome,
  isClosedOutcome,
  type ParsedOutcome,
} from "@/lib/trades/outcome-parser";
import { parseTradeDate } from "@/lib/trades/trade-date";
import { normalizeMt5Symbol } from "@/lib/mt5/normalize-symbol";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import type { AssetType, TradeDirection } from "@/types/database";

export interface TradeDraft {
  readonly instrument: string;
  readonly asset_type: AssetType;
  readonly direction: TradeDirection;
  readonly entry_price: number;
  readonly entry_price_high: number | null;
  readonly stop_loss: number | null;
  readonly tp1: number | null;
  readonly tp2: number | null;
  readonly tp3: number | null;
  readonly tp4: number | null;
  readonly tp5: number | null;
  readonly tp6: number | null;
  readonly tp7: number | null;
  readonly tp4_trailing: boolean;
  readonly outcome: ParsedOutcome;
  /** ISO. Parsed from the text, else the moment it was typed. */
  readonly entry_time: string;
  readonly dated_from_text: boolean;
  /** "today" or "yesterday" when typed that way; null shows the ISO day. */
  readonly date_label: string | null;
  /** Standard lots from "0.5 lots" in the text; null means the caller picks
   *  a size. Lots, not units: the row's `quantity` is units and is derived
   *  from this through the instrument's contract size at save time. */
  readonly lots: number | null;
  /** Exactly what was typed. Kept with the trade so a wrong figure can be traced. */
  readonly message: string;
  /** The message was plain words, translated by the model; the summary says so. */
  readonly read_from_prose?: boolean;
  /** "+80 pips" when the exit was worked out from a stated result. */
  readonly derived_exit?: string | null;
  /** Where a stated result disagrees with the prices. Shown, never hidden. */
  readonly warnings?: readonly string[];
}

export type TradeIntent =
  | { readonly kind: "ready"; readonly draft: TradeDraft; readonly summary: string }
  | { readonly kind: "incomplete"; readonly missing: readonly string[] }
  | { readonly kind: "not_a_trade" };

/** An exit more than this factor from the entry is not this instrument's price. */
const EXIT_RATIO = 2;

/** Pips between two prices, signed by direction. Informational: the stored
 *  figure is recomputed at save time from the same inputs. */
function pipsBetween(
  instrument: string,
  direction: TradeDirection,
  from: number,
  to: number,
): number {
  const { pipSize } = getInstrumentSpec(instrument);
  const raw = (to - from) / pipSize;
  return direction === "buy" ? raw : -raw;
}

function signed(n: number): string {
  const r = Number(n.toFixed(1));
  const safe = Object.is(r, -0) ? 0 : r;
  return `${safe > 0 ? "+" : ""}${safe.toFixed(1)}`;
}

/** The one line a person confirms. Every figure they are about to save. */
export function describeDraft(d: TradeDraft): string {
  const parts: string[] = [
    d.instrument,
    d.direction.toUpperCase(),
    `entry ${d.entry_price}${d.entry_price_high ? `-${d.entry_price_high}` : ""}`,
  ];
  if (d.stop_loss !== null) parts.push(`SL ${d.stop_loss}`);

  const tps = ([1, 2, 3, 4, 5, 6, 7] as const)
    .map((i) => ({ i, v: d[`tp${i}` as const] }))
    .filter((x): x is { i: 1 | 2 | 3 | 4 | 5 | 6 | 7; v: number } => x.v !== null);
  if (tps.length > 0) parts.push(tps.map((t) => `TP${t.i} ${t.v}`).join(" "));

  const o = d.outcome;
  if (o.kind === "closed_at") {
    const pips = pipsBetween(d.instrument, d.direction, d.entry_price, o.exit_price);
    const from = d.derived_exit ? `, from ${d.derived_exit}` : "";
    parts.push(`closed ${o.exit_price} (${signed(pips)} pips${from})`);
  } else if (o.kind === "result") {
    if (o.result === "hit") parts.push(`TP${o.tpIndex ?? 1} hit`);
    else if (o.result === "sl") parts.push("stopped out");
    else parts.push("breakeven");
  } else if (o.kind === "still_open") {
    parts.push("still open");
  }

  if (d.lots !== null) parts.push(`${d.lots} lots`);

  const when = d.date_label ?? (d.dated_from_text ? d.entry_time.slice(0, 10) : "today");
  const lines = [`${parts.join(" · ")}\n${when}`];
  for (const w of d.warnings ?? []) lines.push(`⚠ ${w}`);
  return lines.join("\n");
}

/**
 * Stop and targets on the right side of the entry, said in words.
 *
 * The schema refuses these too, but with a validator's message and only at
 * the tap, after the draft has been shown as if it were fine.
 */
function geometryProblems(
  direction: TradeDirection,
  entry: number,
  entryHigh: number | undefined,
  stop: number | undefined,
  tps: readonly (readonly [number, number | undefined])[],
): string[] {
  const out: string[] = [];
  const word = direction.toUpperCase();
  const top = entryHigh ?? entry;
  if (stop != null) {
    if (direction === "buy" && stop >= entry) {
      out.push(`for a ${word} the stop should be below the entry (SL ${stop}, entry ${entry})`);
    }
    if (direction === "sell" && stop <= top) {
      out.push(`for a ${word} the stop should be above the entry (SL ${stop}, entry ${top})`);
    }
  }
  for (const [i, tp] of tps) {
    if (tp == null) continue;
    if (direction === "buy" && tp <= top) {
      out.push(`for a ${word} TP${i} should be above the entry (TP${i} ${tp}, entry ${top})`);
    }
    if (direction === "sell" && tp >= entry) {
      out.push(`for a ${word} TP${i} should be below the entry (TP${i} ${tp}, entry ${entry})`);
    }
  }
  return out;
}

/**
 * Read a message.
 *
 * `not_a_trade` is important: it is what lets the bot stay silent for
 * "thanks", "morning" and "EURUSD looking bullish above 1.0850", instead of
 * answering every DM with a parse error. The bar for engaging is an entry
 * price or a result, not merely an instrument and a direction.
 */
export function parseTradeIntent(text: string, now: Date): TradeIntent {
  const t = (text ?? "").trim();
  if (!t) return { kind: "not_a_trade" };

  const plan = parseSignalText(t);
  const hasNumber = /\d/.test(t);
  const hasDirectionWord = plan.direction !== undefined || plan.direction_conflict === true;

  if ((!plan.instrument && !hasDirectionWord) || !hasNumber) {
    return { kind: "not_a_trade" };
  }

  const outcome = parseOutcome(t);

  // Commentary. Nothing to log and nothing to ask about.
  if (plan.entry_price == null && outcome.kind === "unknown" && !outcome.reason) {
    return { kind: "not_a_trade" };
  }

  const missing: string[] = [];
  if (plan.instruments.length > 1) {
    missing.push(`one trade per message: I saw ${plan.instruments.join(" and ")}`);
  }
  if (!plan.instrument) missing.push("the instrument (e.g. XAUUSD)");
  if (plan.direction_conflict) {
    missing.push("buy or sell, just once: the message has both");
  } else if (!plan.direction) {
    missing.push("buy or sell");
  }
  if (plan.entry_price == null) missing.push("the entry price");

  if (outcome.kind === "unknown") {
    missing.push(
      outcome.reason
        ? `what happened: ${outcome.reason}`
        : "what happened: an exit price (\"closed 3348\"), a result (\"tp1 hit\", \"sl\", \"be\"), or \"still open\"",
    );
  }

  // A named result is derived from a price we must already have.
  if (outcome.kind === "result") {
    if (outcome.result === "hit") {
      const slot = outcome.tpIndex ?? 1;
      const price = plan[`tp${slot}` as keyof typeof plan];
      if (price == null) missing.push(`the TP${slot} price, since TP${slot} was hit`);
    }
    if (outcome.result === "sl" && plan.stop_loss == null) {
      missing.push("the stop loss price, since it was stopped out");
    }
  }

  if (plan.direction && plan.entry_price != null) {
    missing.push(
      ...geometryProblems(
        plan.direction,
        plan.entry_price,
        plan.entry_price_high,
        plan.stop_loss,
        [1, 2, 3, 4, 5, 6, 7].map((i) => [i, plan[`tp${i}` as keyof typeof plan] as number | undefined] as const),
      ),
    );
    if (outcome.kind === "closed_at") {
      const ratio = outcome.exit_price / plan.entry_price;
      if (ratio > EXIT_RATIO || ratio < 1 / EXIT_RATIO) {
        missing.push(
          `${outcome.exit_price} doesn't look like a ${plan.instrument ?? ""} price next to an entry of ${plan.entry_price}`.replace("  ", " "),
        );
      }
    }
  }

  const date = parseTradeDate(t, now);
  if (date?.kind === "future") missing.push(`${date.label} is in the future`);

  if (missing.length > 0) return { kind: "incomplete", missing };

  // From here every required field is present; the non-null assertions below
  // are guaranteed by the checks above.
  const instrument = plan.instrument!;
  const { assetType } = normalizeMt5Symbol(instrument);
  const dated = date?.kind === "date" ? date : null;

  const draft: TradeDraft = {
    instrument,
    asset_type: assetType,
    direction: plan.direction!,
    entry_price: plan.entry_price!,
    entry_price_high: plan.entry_price_high ?? null,
    stop_loss: plan.stop_loss ?? null,
    tp1: plan.tp1 ?? null,
    tp2: plan.tp2 ?? null,
    tp3: plan.tp3 ?? null,
    tp4: plan.tp4 ?? null,
    tp5: plan.tp5 ?? null,
    tp6: plan.tp6 ?? null,
    tp7: plan.tp7 ?? null,
    tp4_trailing: plan.tp4_trailing ?? false,
    outcome,
    entry_time: dated?.iso ?? now.toISOString(),
    dated_from_text: dated !== null,
    date_label: dated && (dated.label === "today" || dated.label === "yesterday") ? dated.label : null,
    lots: plan.lots ?? null,
    message: t,
  };

  return { kind: "ready", draft, summary: describeDraft(draft) };
}

/** Whether saving this draft produces a trade the reports will count. */
export function draftIsClosed(draft: TradeDraft): boolean {
  return isClosedOutcome(draft.outcome);
}
