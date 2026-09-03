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
 * is the only defence.
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
}

export type TradeIntent =
  | { readonly kind: "ready"; readonly draft: TradeDraft; readonly summary: string }
  | { readonly kind: "incomplete"; readonly missing: readonly string[] }
  | { readonly kind: "not_a_trade" };

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

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  const safe = Object.is(r, -0) ? 0 : r;
  return `${safe > 0 ? "+" : ""}${safe.toFixed(digits)}`;
}

/** The one line a person confirms. Every figure they are about to save. */
export function describeDraft(d: TradeDraft): string {
  const parts: string[] = [
    d.instrument,
    d.direction.toUpperCase(),
    `entry ${fmt(d.entry_price)}${d.entry_price_high ? `-${fmt(d.entry_price_high)}` : ""}`,
  ];
  if (d.stop_loss !== null) parts.push(`SL ${fmt(d.stop_loss)}`);

  const tps = ([1, 2, 3, 4, 5, 6, 7] as const)
    .map((i) => ({ i, v: d[`tp${i}` as const] }))
    .filter((x): x is { i: 1 | 2 | 3 | 4 | 5 | 6 | 7; v: number } => x.v !== null);
  if (tps.length > 0) parts.push(tps.map((t) => `TP${t.i} ${fmt(t.v)}`).join(" "));

  const o = d.outcome;
  if (o.kind === "closed_at") {
    const pips = pipsBetween(d.instrument, d.direction, d.entry_price, o.exit_price);
    parts.push(`closed ${fmt(o.exit_price)} (${signed(pips)} pips)`);
  } else if (o.kind === "result") {
    if (o.result === "hit") parts.push(`TP${o.tpIndex ?? 1} hit`);
    else if (o.result === "sl") parts.push("stopped out");
    else parts.push("breakeven");
  } else if (o.kind === "still_open") {
    parts.push("still open");
  }

  const when = d.dated_from_text
    ? d.entry_time.slice(0, 10)
    : "today";
  return `${parts.join(" · ")}\n${when}`;
}

/**
 * Read a message.
 *
 * `not_a_trade` is important: it is what lets the bot stay silent for "thanks"
 * and "morning", instead of answering every DM with a parse error.
 */
export function parseTradeIntent(text: string, now: Date): TradeIntent {
  const t = (text ?? "").trim();
  if (!t) return { kind: "not_a_trade" };

  const plan = parseSignalText(t);
  const hasNumber = /\d/.test(t);

  // Neither an instrument nor a direction, or no number at all: it is chat.
  if ((!plan.instrument && !plan.direction) || !hasNumber) {
    return { kind: "not_a_trade" };
  }

  const missing: string[] = [];
  if (!plan.instrument) missing.push("the instrument (e.g. XAUUSD)");
  if (!plan.direction) missing.push("buy or sell");
  if (plan.entry_price == null) missing.push("the entry price");

  const outcome = parseOutcome(t);
  if (outcome.kind === "unknown") {
    missing.push(
      "what happened: an exit price (\"closed 3348\"), a result (\"tp1 hit\", \"sl\", \"be\"), or \"still open\"",
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

  if (missing.length > 0) return { kind: "incomplete", missing };

  // From here every required field is present; the non-null assertions below
  // are guaranteed by the checks above.
  const instrument = plan.instrument!;
  const { assetType } = normalizeMt5Symbol(instrument);
  const date = parseTradeDate(t, now);

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
    entry_time: date?.iso ?? now.toISOString(),
    dated_from_text: date !== null,
  };

  return { kind: "ready", draft, summary: describeDraft(draft) };
}

/** Whether saving this draft produces a trade the reports will count. */
export function draftIsClosed(draft: TradeDraft): boolean {
  return isClosedOutcome(draft.outcome);
}
