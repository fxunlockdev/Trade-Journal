/**
 * The listener: a message from a signal room becomes, or changes, a trade.
 *
 * Nobody confirms anything here. Traders post as they always have; Pierre
 * stops copying. So the rules are conservative and every uncertain case is
 * KEPT WITH A REASON rather than guessed: a signal the grammar refuses, a
 * result with no trade to attach to, a target named by a price that matches
 * nothing or two things, a result that contradicts what is already recorded,
 * a result from someone who has never posted a signal in the room.
 *
 * What a result means for the trade follows the app's own model of a
 * multi-target trade (computations.ts): targets hit are banked, the trade
 * closes at the furthest one, and a stop or breakeven after a hit describes
 * the runner coming back, not the whole position. Facts accumulate on the
 * target slots, never overwrite a recorded verdict, and the exit is
 * recomputed each time.
 *
 * Pure over a store interface. Every path is a unit test with messages taken
 * verbatim from the rooms' exports, and every finding of the adversarial
 * review of the first version is a case here.
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
  /** Telegram user id; null for a channel post, where only admins can post. */
  readonly senderId: number | null;
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
  readonly senderId: number | null;
  readonly text: string;
  readonly postedAt: string;
  readonly edited: boolean;
}

/** The slice of a trade row the listener reads and rewrites. */
export type TradeRow = Trade;

export interface FeedStore {
  feedFor(chatId: string, threadId: number | null): Promise<Feed | null>;
  /**
   * Whether the feed's owner may still write trades into its journal. Asked
   * on every write. Null when it could not be checked, which skips the
   * message rather than pausing the room on a blip.
   */
  mayWrite(feed: Feed): Promise<boolean | null>;
  /** Within the feed's allowance of writes this hour. */
  allowWrite(feed: Feed): Promise<boolean>;
  /** Whether this Telegram user has posted a signal the feed accepted. */
  isKnownSender(feed: Feed, senderId: number): Promise<boolean>;
  seen(chatId: string, messageId: number): Promise<Pick<MessageRecord, "kind" | "status" | "tradeId"> | null>;
  record(rec: MessageRecord): Promise<void>;
  /**
   * The trade a signal message became, IN THIS FEED'S JOURNAL AND OWNER. A
   * message id is not a capability: the same room can be connected by
   * someone else, and their trades are not this feed's to touch.
   */
  tradeByMessage(feed: Feed, messageId: number): Promise<TradeRow | null>;
  tradeById(feed: Feed, id: string): Promise<TradeRow | null>;
  /** Recent trades from this feed's journal, newest first, for this instrument if given. */
  recentTrades(feed: Feed, instrument: string | null, since: string, limit: number): Promise<readonly TradeRow[]>;
  insertTrade(row: Record<string, unknown>): Promise<{ id: string } | { duplicate: true } | { error: string }>;
  /** Scoped to the feed's journal as well as the id, so a wrong id cannot cross tenants. */
  updateTrade(feed: Feed, id: string, patch: Record<string, unknown>): Promise<boolean>;
}

export type IngestOutcome =
  | { readonly action: "skipped"; readonly why: "no_feed" | "disabled" | "seen" | "empty" }
  | { readonly action: "noise" }
  | { readonly action: "signal_logged"; readonly tradeId: string }
  | { readonly action: "signal_updated"; readonly tradeId: string }
  | { readonly action: "result_applied"; readonly tradeId: string; readonly closed: boolean }
  | { readonly action: "review"; readonly reason: string };

export interface IngestOptions {
  /** Process again even though the message was seen: a person asked for a retry. */
  readonly force?: boolean;
}

/** How far back a result with no reply link may attach to a running trade: a weekend and then some. */
export const ATTACH_WINDOW_HOURS = 120;
/** How many recent trades to consider for a result with no reply link. */
const ATTACH_CANDIDATES = 10;

type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5, 6, 7];

function tpPrice(t: TradeRow, i: Slot): number | null {
  return (t as unknown as Record<string, number | null>)[`tp${i}`] ?? null;
}
function tpResult(t: TradeRow, i: Slot): TPResult | null {
  return (t as unknown as Record<string, TPResult | null>)[`tp${i}_result`] ?? null;
}

/** Whether anything at all has been recorded against the trade. */
function hasVerdict(t: TradeRow): boolean {
  return t.exit_price !== null || SLOTS.some((i) => tpResult(t, i) !== null);
}

/**
 * Whether a result could still apply: nothing recorded yet, or targets
 * banked with a runner still alive (an open final target, or a priced
 * target with no verdict) and no stop or breakeven recorded after them.
 */
export function stillRunning(t: TradeRow): boolean {
  const results = SLOTS.map((i) => tpResult(t, i));
  const anyHit = results.some((r) => r === "hit");
  const ended = results.some((r) => r === "sl" || r === "be");
  if (!anyHit && !ended) return t.exit_price === null;
  if (ended) return false;
  const furthest = Math.max(...results.map((r, i) => (r === "hit" ? i + 1 : 0)));
  const laterPriced = SLOTS.some((i) => i > furthest && tpPrice(t, i) !== null && tpResult(t, i) === null);
  return laterPriced || t.tp4_trailing === true;
}

function record(feed: Feed, msg: FeedMessage, kind: MessageKind, status: MessageStatus, reason: string | null, tradeId: string | null): MessageRecord {
  return {
    chatId: msg.chatId, messageId: msg.messageId, threadId: msg.threadId, feedId: feed.id,
    kind, status, reason, tradeId, replyToMessageId: msg.replyToMessageId,
    sender: msg.sender, senderId: msg.senderId, text: msg.text, postedAt: msg.postedAt, edited: msg.edited,
  };
}

/** The row for a signal, sized by the feed's default lots, dated by the message. */
function signalRow(feed: Feed, msg: FeedMessage, d: TradeDraft): ReturnType<typeof buildTradeRow> {
  const { contractSize } = getInstrumentSpec(d.instrument);
  const tps = [d.tp1, d.tp2, d.tp3, d.tp4, d.tp5, d.tp6, d.tp7];
  const mentionsSecond = /second\s+entry/i.test(d.message);
  const notes = [
    `From Telegram${msg.sender ? ` (${msg.sender})` : ""}: ${d.message}`,
    d.entry_second && !mentionsSecond ? `Second entry: ${d.entry_second}` : null,
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

export type Applied =
  | { readonly patch: Record<string, unknown>; readonly closed: boolean }
  | { readonly reason: string; readonly review: boolean };

/**
 * Apply the facts in a result update to a trade's target slots.
 *
 * Never overwrites a recorded verdict: a hit claimed on or beyond a slot that
 * holds a stop or breakeven is a contradiction and goes to review, as does a
 * price that matches no target or two, an index whose stated price disagrees
 * with the trade, and a stated pips figure with the wrong sign.
 */
export function applyResult(trade: TradeRow, u: ResultUpdate): Applied {
  const results: (TPResult | null)[] = SLOTS.map((i) => tpResult(trade, i));
  const prices: (number | null)[] = SLOTS.map((i) => tpPrice(trade, i));
  const priced = prices.map((p, i) => ({ p, i: i + 1 })).filter((x): x is { p: number; i: number } => x.p !== null);

  // A target named by price must sit closer to one target than to any
  // other: a quarter of the smallest gap between targets, or 0.2% when
  // there is only one. Relative tolerance alone was wider than a whole
  // ladder of 10-pip targets.
  const gaps = priced.slice(1).map((x, k) => Math.abs(x.p - priced[k].p));
  const tolerance = gaps.length > 0 ? Math.min(...gaps) / 4 : (priced[0]?.p ?? trade.entry_price) * 0.002;

  const problems: string[] = [];
  const slotByPrice = (price: number): number | null => {
    const near = priced.filter((x) => Math.abs(x.p - price) <= tolerance);
    if (near.length === 1) return near[0].i;
    if (near.length > 1) { problems.push(`${price} is too close to two targets`); return null; }
    const lo = Math.min(...priced.map((x) => x.p));
    const hi = Math.max(...priced.map((x) => x.p));
    problems.push(price > lo && price < hi ? `${price} is between targets, not on one` : `no target at ${price}`);
    return null;
  };
  const markHit = (idx: number): void => {
    for (let i = 1; i <= idx; i += 1) {
      if (prices[i - 1] === null) continue;
      const have = results[i - 1];
      if (have === "sl" || have === "be") {
        problems.push(`TP${idx} hit contradicts the ${have === "sl" ? "stop" : "breakeven"} recorded on TP${i}`);
        return;
      }
      results[i - 1] = "hit";
    }
  };

  for (const i of u.hits) {
    if (prices[i - 1] === null) { problems.push(`TP${i} has no price on the trade`); continue; }
    const stated = u.indexedHits.find((h) => h.index === i);
    if (stated && Math.abs(stated.price - (prices[i - 1] as number)) > tolerance) {
      problems.push(`TP${i} was reported at ${stated.price} but the trade's TP${i} is ${prices[i - 1]}`);
      continue;
    }
    markHit(i);
  }
  for (const price of u.hitPrices) {
    const idx = slotByPrice(price);
    if (idx !== null) markHit(idx);
  }
  for (const ph of u.pricedHits) {
    const own = prices[ph.index - 1];
    const idx = own !== null && Math.abs(own - ph.price) <= tolerance ? ph.index : slotByPrice(ph.price);
    if (idx !== null) markHit(idx);
  }

  const anyHitNow = results.some((r) => r === "hit");
  const hadHit = SLOTS.some((i) => tpResult(trade, i) === "hit");
  const newHit = anyHitNow && SLOTS.some((i) => results[i - 1] === "hit" && tpResult(trade, i) !== "hit");

  // A stated pips figure is the one sanity check the data offers.
  if (newHit && u.pips !== null && u.pips < 0) {
    problems.push(`says ${u.pips} pips but reports a target hit`);
  }

  if (problems.length > 0) return { reason: problems.join("; "), review: true };

  const runnerVerdict = (verdict: TPResult): boolean => {
    if (!anyHitNow) {
      // Nothing banked: the whole position took the verdict.
      if (results[0] === null || results[0] === verdict) { results[0] = verdict; return true; }
      return false;
    }
    // Something banked: the verdict is the runner's, on the first priced slot
    // after the furthest hit; with none left the banked exit already stands.
    const furthest = Math.max(...results.map((r, i) => (r === "hit" ? i + 1 : 0)));
    for (let i = furthest + 1; i <= 7; i += 1) {
      if (prices[i - 1] !== null && results[i - 1] === null) { results[i - 1] = verdict; return true; }
    }
    return true;
  };
  if (u.stopped) runnerVerdict("sl");
  if (u.breakeven && !u.stopped) runnerVerdict("be");

  const patch: Record<string, unknown> = {};
  SLOTS.forEach((i) => { patch[`tp${i}_result`] = results[i - 1]; });
  if (u.closedAt !== null) {
    if (anyHitNow || hadHit) {
      return { reason: `closed at ${u.closedAt} after targets were hit; check the exit`, review: true };
    }
    if (!u.stopped && !u.breakeven) patch.exit_price = u.closedAt;
  }

  const changed = SLOTS.some((i) => results[i - 1] !== tpResult(trade, i)) || patch.exit_price !== undefined;
  if (!changed) {
    const allDone = anyHitNow && (u.stopped || u.breakeven);
    return { reason: allDone ? "runner closed after the last priced target; the exit stays at that target" : "nothing new in that update", review: false };
  }

  const merged = { ...trade, ...patch } as TradeRow;
  const computed = computeTradeFields(merged);
  return {
    patch: {
      ...patch,
      exit_price: computed.exit_price,
      pnl_absolute: computed.pnl_absolute,
      pnl_percentage: computed.pnl_percentage,
      pnl_currency: computed.pnl_currency,
      pnl_rate_quality: computed.pnl_rate_quality,
      risk_reward_ratio: computed.risk_reward_ratio,
      r_multiple: computed.r_multiple,
    },
    closed: computed.exit_price !== null,
  };
}

/** Which instrument a result mentions, if exactly one, for attaching without a reply link. */
function mentionedInstrument(text: string): string | null {
  const found = findInstruments(expandAliases(text));
  return found.length === 1 ? found[0] : null;
}

export async function ingestFeedMessage(store: FeedStore, msg: FeedMessage, now: Date, opts: IngestOptions = {}): Promise<IngestOutcome> {
  const feed = (await store.feedFor(msg.chatId, msg.threadId)) ?? (await store.feedFor(msg.chatId, null));
  if (!feed) return { action: "skipped", why: "no_feed" };
  if (!feed.enabled) return { action: "skipped", why: "disabled" };

  const text = msg.text.trim();
  if (!text) return { action: "skipped", why: "empty" };

  const seen = await store.seen(msg.chatId, msg.messageId);
  if (seen && !msg.edited && !opts.force) return { action: "skipped", why: "seen" };

  const intent = parseTradeIntent(text, new Date(msg.postedAt));
  const priorTrade = msg.edited || opts.force ? await store.tradeByMessage(feed, msg.messageId) : null;

  // Before any write: may the owner still write, and is the room within its
  // allowance. A failed check skips the message and keeps it for a person;
  // a failed LOOKUP skips it without pausing anything.
  const guard = async (tradeId: string | null): Promise<IngestOutcome | null> => {
    const may = await store.mayWrite(feed);
    if (may === null) {
      const reason = "couldn't check access to the journal; retry";
      await store.record(record(feed, msg, "unreadable", "review", reason, tradeId));
      return { action: "review", reason };
    }
    if (!may) {
      const reason = "the person who connected this room can no longer write to that journal";
      await store.record(record(feed, msg, "unreadable", "review", reason, tradeId));
      return { action: "review", reason };
    }
    if (!(await store.allowWrite(feed))) {
      const reason = "too many trades from this room this hour; retry later";
      await store.record(record(feed, msg, "unreadable", "review", reason, tradeId));
      return { action: "review", reason };
    }
    return null;
  };

  /* ── a signal ─────────────────────────────────────────────────────── */
  if (intent.kind === "ready") {
    const built = signalRow(feed, msg, intent.draft);
    if (!built.ok) {
      await store.record(record(feed, msg, "signal", "review", built.issues.join("; "), priorTrade?.id ?? null));
      return { action: "review", reason: built.issues.join("; ") };
    }
    const stopped = await guard(priorTrade?.id ?? null);
    if (stopped) return stopped;
    if (priorTrade) {
      // An edited signal: the plan changed. Only while nothing has happened to
      // it; once results are on it, the edit is kept for a person.
      if (hasVerdict(priorTrade)) {
        const reason = "signal edited after results were applied";
        await store.record(record(feed, msg, "signal", "review", reason, priorTrade.id));
        return { action: "review", reason };
      }
      const { user_id: _u, journal_id: _j, source: _s, ...plan } = built.row;
      void _u; void _j; void _s;
      const ok = await store.updateTrade(feed, priorTrade.id, plan);
      await store.record(record(feed, msg, "signal", ok ? "applied" : "review", ok ? null : "could not update the trade", priorTrade.id));
      return ok ? { action: "signal_updated", tradeId: priorTrade.id } : { action: "review", reason: "could not update the trade" };
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

  // The message used to be a signal and is not one any more: a trader
  // cancelling by editing. The trade is not removed by a machine.
  if (priorTrade) {
    const reason = "the signal was edited into something else; check the trade";
    await store.record(record(feed, msg, "signal", "review", reason, priorTrade.id));
    return { action: "review", reason };
  }

  /* ── a result ─────────────────────────────────────────────────────── */
  const update = parseResultUpdate(text);
  if (hasResult(update)) {
    let trade: TradeRow | null = null;
    if (msg.replyToMessageId !== null) {
      trade = await store.tradeByMessage(feed, msg.replyToMessageId);
      if (!trade) {
        // A reply to an earlier result or remark: follow it to its trade.
        const parent = await store.seen(msg.chatId, msg.replyToMessageId);
        if (parent?.tradeId) trade = await store.tradeById(feed, parent.tradeId);
      }
    }
    if (!trade) {
      // No reply link: the one trade still running for the instrument named,
      // or the one trade running at all. Two candidates is a question.
      const since = new Date(now.getTime() - ATTACH_WINDOW_HOURS * 3600_000).toISOString();
      const instrument = mentionedInstrument(text);
      const running = (await store.recentTrades(feed, instrument, since, ATTACH_CANDIDATES)).filter(stillRunning);
      if (running.length === 1) trade = running[0];
      else if (running.length > 1) {
        const reason = instrument
          ? `more than one ${instrument} trade is running; which one?`
          : "no instrument named and more than one trade is running";
        await store.record(record(feed, msg, "result", "review", reason, null));
        return { action: "review", reason };
      }
    }
    if (!trade) {
      const reason = "a result with no open trade to attach to";
      await store.record(record(feed, msg, "result", "review", reason, null));
      return { action: "review", reason };
    }

    // Only a trader's word counts: someone who has posted a signal the feed
    // accepted, or the channel itself. Anyone else in the room is a member.
    if (msg.senderId !== null && !(await store.isKnownSender(feed, msg.senderId))) {
      const reason = `posted by ${msg.sender ?? "someone"} who has not posted a signal in this room`;
      await store.record(record(feed, msg, "result", "review", reason, trade.id));
      return { action: "review", reason };
    }

    // An edited result cannot be undone by a machine: if it changed, ask.
    if (msg.edited && seen?.status === "applied") {
      const reason = "a result was edited after it was applied; check the trade";
      await store.record(record(feed, msg, "result", "review", reason, trade.id));
      return { action: "review", reason };
    }

    const applied = applyResult(trade, update);
    if ("reason" in applied) {
      if (msg.edited && seen) return { action: "noise" };
      await store.record(record(feed, msg, "result", applied.review ? "review" : "ignored", applied.reason, trade.id));
      return applied.review ? { action: "review", reason: applied.reason } : { action: "noise" };
    }
    const stopped = await guard(trade.id);
    if (stopped) return stopped;
    const ok = await store.updateTrade(feed, trade.id, {
      ...applied.patch,
      ...(applied.closed ? { exit_time: msg.postedAt } : {}),
    });
    await store.record(record(feed, msg, "result", ok ? "applied" : "review", ok ? null : "could not update the trade", trade.id));
    return ok ? { action: "result_applied", tradeId: trade.id, closed: applied.closed } : { action: "review", reason: "could not update the trade" };
  }

  /* ── a broken signal, or chat ─────────────────────────────────────── */
  if (intent.kind === "incomplete") {
    await store.record(record(feed, msg, "unreadable", "review", intent.missing.join("; "), null));
    return { action: "review", reason: intent.missing.join("; ") };
  }

  // Chat that replies into a trade's thread is remembered, so a reply to it
  // ("TP2 hit" under "nice one boss") still finds the trade.
  if (msg.replyToMessageId !== null) {
    const parent = (await store.tradeByMessage(feed, msg.replyToMessageId))?.id ?? (await store.seen(msg.chatId, msg.replyToMessageId))?.tradeId ?? null;
    if (parent) await store.record(record(feed, msg, "noise", "ignored", null, parent));
  }
  return { action: "noise" };
}

/**
 * Whether the feed took the message, so the webhook stops there. Chat, a
 * paused room and a redelivery fall through to the bot's other duties in that
 * chat (a claim code, a report command), which a listened room does not lose.
 */
export function consumedByFeed(outcome: IngestOutcome): boolean {
  return outcome.action === "signal_logged" || outcome.action === "signal_updated" || outcome.action === "result_applied" || outcome.action === "review";
}
