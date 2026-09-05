/**
 * The listener: a message from a signal room becomes, or changes, a trade.
 *
 * Nobody confirms anything here. Traders post as they always have; Pierre
 * stops copying. So the rules are conservative and every uncertain case is
 * KEPT WITH A REASON rather than guessed: a signal the grammar refuses, a
 * result with no trade to attach to, a target named by a price that matches
 * nothing. Those go to a review list; the rest is logged.
 *
 * What a result means for the trade follows the app's own model of a
 * multi-target trade (computations.ts): targets hit are banked, the trade
 * closes at the furthest one, and a stop or breakeven after a hit describes
 * the runner coming back, not the whole position. So facts accumulate on
 * the target slots and the exit is recomputed each time.
 *
 * Pure over a store interface. Every path is a unit test with messages taken
 * verbatim from the rooms' exports.
 */

import { parseTradeIntent, type TradeDraft } from "@/lib/telegram/trade-intent";
import { parseResultUpdate, hasResult, type ResultUpdate } from "@/lib/telegram/result-update";
import { outcomeFields } from "@/lib/trades/outcome-parser";
import { findInstruments } from "@/lib/trades/signal-parser";
import { expandAliases } from "@/lib/trades/instrument-aliases";
import { buildTradeRow } from "@/lib/trades/build-trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import type { Trade, TPResult } from "@/types/database";

export interface Feed {
  readonly id: string;
  readonly chatId: string;
  readonly threadId: number | null;
  readonly journalId: string;
  readonly userId: string;
  readonly defaultLots: number;
  readonly enabled: boolean;
  readonly react: boolean;
}

export interface FeedMessage {
  readonly chatId: string;
  readonly messageId: number;
  readonly threadId: number | null;
  readonly replyToMessageId: number | null;
  readonly text: string;
  readonly sender: string | null;
  /** ISO, from Telegram's own timestamp. */
  readonly postedAt: string;
  readonly edited: boolean;
}

export type MessageKind = "signal" | "result" | "noise" | "unreadable";
export type MessageStatus = "applied" | "review" | "ignored" | "superseded";

export interface MessageRecord {
  readonly chatId: string;
  readonly messageId: number;
  readonly threadId: number | null;
  readonly feedId: string;
  readonly kind: MessageKind;
  readonly status: MessageStatus;
  readonly reason: string | null;
  readonly tradeId: string | null;
  readonly replyToMessageId: number | null;
  readonly sender: string | null;
  readonly text: string;
  readonly postedAt: string;
  readonly edited: boolean;
}

/** The slice of a trade row the listener reads and rewrites. */
export type TradeRow = Trade;

export interface FeedStore {
  feedFor(chatId: string, threadId: number | null): Promise<Feed | null>;
  seen(chatId: string, messageId: number): Promise<Pick<MessageRecord, "kind" | "status" | "tradeId"> | null>;
  record(rec: MessageRecord): Promise<void>;
  /** The trade a signal message became. */
  tradeByMessage(chatId: string, messageId: number): Promise<TradeRow | null>;
  tradeById(id: string): Promise<TradeRow | null>;
  /** The newest still-open trade in the journal, for this instrument if given. */
  latestOpenTrade(journalId: string, instrument: string | null, since: string): Promise<TradeRow | null>;
  insertTrade(row: Record<string, unknown>): Promise<{ id: string } | { duplicate: true } | { error: string }>;
  updateTrade(id: string, patch: Record<string, unknown>): Promise<boolean>;
}

export type IngestOutcome =
  | { readonly action: "skipped"; readonly why: "no_feed" | "disabled" | "seen" | "empty" }
  | { readonly action: "noise" }
  | { readonly action: "signal_logged"; readonly tradeId: string }
  | { readonly action: "signal_updated"; readonly tradeId: string }
  | { readonly action: "result_applied"; readonly tradeId: string; readonly closed: boolean }
  | { readonly action: "review"; readonly reason: string };

/** How far back a result with no reply link may attach to an open trade. */
const ATTACH_WINDOW_HOURS = 72;
/** A target named by price matches a slot within this fraction of its price. */
const PRICE_MATCH_TOLERANCE = 0.002;

type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5, 6, 7];

function tpPrice(t: TradeRow, i: Slot): number | null {
  return (t as unknown as Record<string, number | null>)[`tp${i}`] ?? null;
}
function tpResult(t: TradeRow, i: Slot): TPResult | null {
  return (t as unknown as Record<string, TPResult | null>)[`tp${i}_result`] ?? null;
}

function isClosed(t: TradeRow): boolean {
  return t.exit_price !== null || SLOTS.some((i) => tpResult(t, i) !== null);
}

function record(feed: Feed, msg: FeedMessage, kind: MessageKind, status: MessageStatus, reason: string | null, tradeId: string | null): MessageRecord {
  return {
    chatId: msg.chatId, messageId: msg.messageId, threadId: msg.threadId, feedId: feed.id,
    kind, status, reason, tradeId, replyToMessageId: msg.replyToMessageId,
    sender: msg.sender, text: msg.text, postedAt: msg.postedAt, edited: msg.edited,
  };
}

/** The row for a signal, sized by the feed's default lots, dated by the message. */
function signalRow(feed: Feed, msg: FeedMessage, d: TradeDraft): ReturnType<typeof buildTradeRow> {
  const { contractSize } = getInstrumentSpec(d.instrument);
  const tps = [d.tp1, d.tp2, d.tp3, d.tp4, d.tp5, d.tp6, d.tp7];
  const notes = [
    `From Telegram${msg.sender ? ` (${msg.sender})` : ""}: ${d.message}`,
    d.entry_second ? `Second entry: ${d.entry_second}` : null,
  ].filter(Boolean).join("\n");
  return buildTradeRow(
    {
      instrument: d.instrument,
      asset_type: d.asset_type,
      direction: d.direction,
      entry_price: d.entry_price,
      entry_price_high: d.entry_price_high,
      quantity: feed.defaultLots * contractSize,
      lot_size: feed.defaultLots,
      entry_time: msg.postedAt,
      stop_loss: d.stop_loss,
      tp1: d.tp1, tp2: d.tp2, tp3: d.tp3, tp4: d.tp4, tp5: d.tp5, tp6: d.tp6, tp7: d.tp7,
      tp4_trailing: d.tp4_trailing,
      take_profit: d.tp1,
      notes,
      ...outcomeFields(d.outcome, tps),
    },
    { userId: feed.userId, journalId: feed.journalId, source: "telegram" },
  );
}

/**
 * Apply the facts in a result update to a trade's target slots.
 * Returns the patch to write, or a reason nothing could be applied.
 */
export function applyResult(trade: TradeRow, u: ResultUpdate): { patch: Record<string, unknown>; closed: boolean } | { reason: string } {
  const results: (TPResult | null)[] = SLOTS.map((i) => tpResult(trade, i));
  const prices: (number | null)[] = SLOTS.map((i) => tpPrice(trade, i));
  const markHit = (idx: number): void => {
    // Targets before the one hit were passed on the way.
    for (let i = 1; i <= idx; i += 1) if (prices[i - 1] !== null) results[i - 1] = "hit";
  };
  const slotByPrice = (price: number): number | null => {
    let best: number | null = null;
    let bestDiff = Infinity;
    prices.forEach((p, i) => {
      if (p === null) return;
      const diff = Math.abs(p - price) / p;
      if (diff <= PRICE_MATCH_TOLERANCE && diff < bestDiff) { best = i + 1; bestDiff = diff; }
    });
    return best;
  };

  const unmatched: string[] = [];
  for (const i of u.hits) {
    if (prices[i - 1] === null) { unmatched.push(`TP${i} has no price on the trade`); continue; }
    markHit(i);
  }
  for (const price of u.hitPrices) {
    const idx = slotByPrice(price);
    if (idx === null) { unmatched.push(`no target at ${price}`); continue; }
    markHit(idx);
  }
  for (const ph of u.pricedHits) {
    const idx = prices[ph.index - 1] !== null && Math.abs((prices[ph.index - 1] as number) - ph.price) / ph.price <= PRICE_MATCH_TOLERANCE
      ? ph.index
      : slotByPrice(ph.price);
    if (idx === null) { unmatched.push(`no target at ${ph.price}`); continue; }
    markHit(idx);
  }

  const anyHit = results.some((r) => r === "hit");
  const runnerVerdict = (verdict: TPResult): void => {
    if (!anyHit) {
      // Nothing banked: the whole position took the verdict.
      results[0] = verdict;
      return;
    }
    // Something banked: the verdict is the runner's. It goes on the first
    // priced slot after the furthest hit; with none left, the banked exit stands.
    const furthest = Math.max(...results.map((r, i) => (r === "hit" ? i + 1 : 0)));
    for (let i = furthest + 1; i <= 7; i += 1) {
      if (prices[i - 1] !== null && results[i - 1] === null) { results[i - 1] = verdict; return; }
    }
  };
  if (u.stopped) runnerVerdict("sl");
  if (u.breakeven && !u.stopped) runnerVerdict("be");

  const patch: Record<string, unknown> = {};
  SLOTS.forEach((i) => { patch[`tp${i}_result`] = results[i - 1]; });
  if (u.closedAt !== null && !anyHit && !u.stopped && !u.breakeven) patch.exit_price = u.closedAt;

  const changed = SLOTS.some((i) => results[i - 1] !== tpResult(trade, i)) || patch.exit_price !== undefined;
  if (!changed) {
    return { reason: unmatched.length > 0 ? unmatched.join("; ") : "nothing new in that update" };
  }

  const merged = { ...trade, ...patch } as TradeRow;
  const computed = computeTradeFields(merged);
  return {
    patch: {
      ...patch,
      exit_price: computed.exit_price,
      pnl_absolute: computed.pnl_absolute,
      pnl_percentage: computed.pnl_percentage,
      risk_reward_ratio: computed.risk_reward_ratio,
      r_multiple: computed.r_multiple,
    },
    closed: computed.exit_price !== null,
  };
}

/** Which instrument a result mentions, if any, for attaching without a reply link. */
function mentionedInstrument(text: string): string | null {
  const found = findInstruments(expandAliases(text));
  return found.length === 1 ? found[0] : null;
}

export async function ingestFeedMessage(store: FeedStore, msg: FeedMessage, now: Date): Promise<IngestOutcome> {
  const text = msg.text.trim();
  if (!text) return { action: "skipped", why: "empty" };

  const feed = (await store.feedFor(msg.chatId, msg.threadId)) ?? (await store.feedFor(msg.chatId, null));
  if (!feed) return { action: "skipped", why: "no_feed" };
  if (!feed.enabled) return { action: "skipped", why: "disabled" };

  const seen = await store.seen(msg.chatId, msg.messageId);
  if (seen && !msg.edited) return { action: "skipped", why: "seen" };

  const intent = parseTradeIntent(text, new Date(msg.postedAt));

  /* ── a signal ─────────────────────────────────────────────────────── */
  if (intent.kind === "ready") {
    const existing = msg.edited ? await store.tradeByMessage(msg.chatId, msg.messageId) : null;
    const built = signalRow(feed, msg, intent.draft);
    if (!built.ok) {
      await store.record(record(feed, msg, "signal", "review", built.issues.join("; "), existing?.id ?? null));
      return { action: "review", reason: built.issues.join("; ") };
    }
    if (existing) {
      // An edited signal: the plan changed. Only while nothing has happened to
      // it; once results are on it, the edit is kept for a person.
      if (isClosed(existing)) {
        await store.record(record(feed, msg, "signal", "review", "signal edited after results were applied", existing.id));
        return { action: "review", reason: "signal edited after results were applied" };
      }
      const { user_id: _u, journal_id: _j, source: _s, ...plan } = built.row;
      void _u; void _j; void _s;
      const ok = await store.updateTrade(existing.id, plan);
      await store.record(record(feed, msg, "signal", ok ? "applied" : "review", ok ? null : "could not update the trade", existing.id));
      return ok ? { action: "signal_updated", tradeId: existing.id } : { action: "review", reason: "could not update the trade" };
    }
    const inserted = await store.insertTrade({
      ...built.row,
      telegram_chat_id: msg.chatId,
      telegram_message_id: msg.messageId,
    });
    if ("duplicate" in inserted) return { action: "skipped", why: "seen" };
    if ("error" in inserted) {
      await store.record(record(feed, msg, "signal", "review", inserted.error, null));
      return { action: "review", reason: inserted.error };
    }
    await store.record(record(feed, msg, "signal", "applied", null, inserted.id));
    return { action: "signal_logged", tradeId: inserted.id };
  }

  /* ── a result ─────────────────────────────────────────────────────── */
  const update = parseResultUpdate(text);
  if (hasResult(update)) {
    let trade: TradeRow | null = null;
    if (msg.replyToMessageId !== null) {
      trade = await store.tradeByMessage(msg.chatId, msg.replyToMessageId);
      if (!trade) {
        // A reply to an earlier result: follow it to its trade.
        const parent = await store.seen(msg.chatId, msg.replyToMessageId);
        if (parent?.tradeId) trade = await store.tradeById(parent.tradeId);
      }
    }
    if (!trade) {
      const since = new Date(now.getTime() - ATTACH_WINDOW_HOURS * 3600_000).toISOString();
      trade = await store.latestOpenTrade(feed.journalId, mentionedInstrument(text), since);
    }
    if (!trade) {
      await store.record(record(feed, msg, "result", "review", "a result with no open trade to attach to", null));
      return { action: "review", reason: "a result with no open trade to attach to" };
    }
    const applied = applyResult(trade, update);
    if ("reason" in applied) {
      const status: MessageStatus = /no target|no price/.test(applied.reason) ? "review" : "ignored";
      await store.record(record(feed, msg, "result", status, applied.reason, trade.id));
      return status === "review" ? { action: "review", reason: applied.reason } : { action: "noise" };
    }
    const ok = await store.updateTrade(trade.id, {
      ...applied.patch,
      ...(applied.closed && !trade.exit_time ? { exit_time: msg.postedAt } : {}),
    });
    await store.record(record(feed, msg, "result", ok ? "applied" : "review", ok ? null : "could not update the trade", trade.id));
    return ok ? { action: "result_applied", tradeId: trade.id, closed: applied.closed } : { action: "review", reason: "could not update the trade" };
  }

  /* ── a broken signal, or chat ─────────────────────────────────────── */
  if (intent.kind === "incomplete") {
    await store.record(record(feed, msg, "unreadable", "review", intent.missing.join("; "), null));
    return { action: "review", reason: intent.missing.join("; ") };
  }
  return { action: "noise" };
}

