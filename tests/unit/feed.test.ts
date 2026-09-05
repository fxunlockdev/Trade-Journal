import { describe, expect, it } from "vitest";
import {
  ingestFeedMessage, applyResult, consumedByFeed, wantsMark, stillRunning, ATTACH_WINDOW_HOURS, ATTACH_CANDIDATES,
  type Feed, type FeedMessage, type FeedStore, type MessageRecord, type TradeRow,
} from "@/lib/telegram/feed";
import { parseResultUpdate } from "@/lib/telegram/result-update";

/**
 * The listener, end to end over a fake store, with messages taken verbatim
 * from the four rooms' exports. Nobody confirms anything here, so the
 * assertions are on what lands in the journal and on what is kept for a
 * person instead. Every finding of the adversarial review is a case.
 */

const U = "11111111-2222-4333-8444-555555555555";
const J = "aaaaaaaa-0000-4000-8000-000000000001";

const feed: Feed = { id: "feed-1", chatId: "-100999", threadId: null, journalId: J, userId: U, defaultLots: 0.5, enabled: true, react: false };

function msg(o: Partial<FeedMessage> & { text: string }): FeedMessage {
  return { chatId: "-100999", messageId: 1, threadId: null, replyToMessageId: null, sender: "Yohan Morel", senderId: 1, postedAt: "2026-09-04T14:00:00.000Z", edited: false, ...o };
}

interface Fake { store: FeedStore; trades: Map<string, TradeRow>; byMessage: Map<number, string>; records: MessageRecord[]; updates: [string, Record<string, unknown>][] }

function fake(o: Partial<FeedStore> = {}, f: Feed | null = feed): Fake {
  const trades = new Map<string, TradeRow>();
  const byMessage = new Map<number, string>();
  const records: MessageRecord[] = [];
  const updates: [string, Record<string, unknown>][] = [];
  let n = 0;
  const inJournal = (fd: Feed, t: TradeRow): boolean => (t as unknown as Record<string, unknown>).journal_id === fd.journalId;
  const store: FeedStore = {
    feedFor: async (chatId, threadId) => (f && f.chatId === chatId && f.threadId === threadId ? f : null),
    mayWrite: async () => true,
    allowWrite: async () => true,
    // A trader is someone whose signal the feed accepted.
    isKnownSender: async (fd, senderId) => records.some((r) => r.feedId === fd.id && r.kind === "signal" && r.status === "applied" && r.senderId === senderId),
    seen: async (_c, id) => { const r = records.find((x) => x.messageId === id); return r ? { kind: r.kind, status: r.status, tradeId: r.tradeId, text: r.text } : null; },
    record: async (r) => { const i = records.findIndex((x) => x.messageId === r.messageId); if (i >= 0) records[i] = r; else records.push(r); },
    tradeByMessage: async (fd, id) => { const t = byMessage.get(id); const tr = t ? trades.get(t) : null; return tr && inJournal(fd, tr) ? tr : null; },
    tradeById: async (fd, id) => { const tr = trades.get(id); return tr && inJournal(fd, tr) ? tr : null; },
    // The real query: this FEED's accepted signals inside the window, newest first, capped; then their trades.
    recentTrades: async (fd, instrument, since, until, limit) =>
      records
        .filter((r) => r.feedId === fd.id && r.kind === "signal" && r.status === "applied" && r.tradeId && r.postedAt >= since && r.postedAt <= until)
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .slice(0, limit)
        .map((r) => trades.get(r.tradeId as string)!)
        .filter((t) => inJournal(fd, t) && (!instrument || t.instrument === instrument)),
    insertTrade: async (row) => {
      n += 1;
      const id = `t${n}`;
      trades.set(id, { id, exit_time: null, ...row } as unknown as TradeRow);
      byMessage.set(row.telegram_message_id as number, id);
      return { id };
    },
    updateTrade: async (_fd, id, patch) => {
      updates.push([id, patch]);
      const t = trades.get(id);
      if (t) trades.set(id, { ...t, ...patch } as TradeRow);
      return true;
    },
    ...o,
  };
  return { store, trades, byMessage, records, updates };
}

const YOHAN = "🔴 SELL: USD/JPY\n\n📍 ENTRY ZONE : 163.730\n\n🎯 TP1: 163.630 (+10pips)\n🎯 TP2: 163.530 (+20 pips)\n🎯 TP3: 163.430 (+30 pips)\n🎯 FINAL TP: Open\n\n🛑 SL: 163.830 (-10pips)\n\n____________________________\n\nThis is not financial advice,\ntrade at your own risk.";
const TIG = "🔵BUY  XAUUSD\nENTRY: 4374\nSecond entry: 4369\n\nSL: 4360\nTP1: 4380\nTP2: 4385\nTP3: 4390\nTP4: open\n\nManage risk properly.";
const CHRIS = "🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: 64300-64400$\n\n🎯 TP1: 64000 (+400)\n🎯 TP2: 63600 (+800)\n🎯 TP3: 63300 (+1100)\n🎯 FINAL TP: Open\n\n🛑 SL: 65000 (-600)";

async function withSignal(text = YOHAN, id = 21, f = fake()) {
  await ingestFeedMessage(f.store, msg({ text, messageId: id }));
  return f;
}

describe("a signal", () => {
  it("becomes an open trade in the feed's journal, sized by the feed, dated by the message", async () => {
    const f = fake();
    const r = await ingestFeedMessage(f.store, msg({ text: YOHAN, messageId: 21 }));
    expect(r).toEqual({ action: "signal_logged", tradeId: "t1", react: false });
    const t = f.trades.get("t1") as unknown as Record<string, unknown>;
    expect(t).toMatchObject({
      user_id: U, journal_id: J, source: "telegram",
      instrument: "USDJPY", direction: "sell", entry_price: 163.73, stop_loss: 163.83,
      tp1: 163.63, tp2: 163.53, tp3: 163.43, tp4_trailing: true,
      lot_size: 0.5, quantity: 50000, entry_time: "2026-09-04T14:00:00.000Z",
      exit_price: null, telegram_chat_id: "-100999", telegram_message_id: 21,
    });
    expect(String(t.notes)).toContain("From Telegram (Yohan Morel): 🔴 SELL: USD/JPY");
    expect(f.records[0]).toMatchObject({ kind: "signal", status: "applied", tradeId: "t1", messageId: 21, senderId: 1 });
  });

  it("is logged once however often Telegram delivers it", async () => {
    const f = await withSignal(TIG, 5);
    expect(await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5 }))).toEqual({ action: "skipped", why: "seen" });
    expect(f.trades.size).toBe(1);
  });

  it("keeps gold's 100 oz a lot and does not repeat a second entry the message already states", async () => {
    const f = await withSignal(TIG, 5);
    const t = f.trades.get("t1") as unknown as Record<string, unknown>;
    expect(t.quantity).toBe(50);
    expect(t.tp4_trailing).toBe(true);
    expect((String(t.notes).match(/Second entry/gi) ?? []).length).toBe(1);
  });

  it("keeps a signal the grammar refuses for a person, with the reason", async () => {
    const broken = "🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: 64500-64600\n\n🎯 TP1: 64200 (+400)\n🎯 TP2: 63800 (+800)\n🎯 TP3: 63500 (+1100)\n🎯 FINAL TP: Open\n\n🛑 SL: 64100 (-500)";
    const f = fake();
    const r = await ingestFeedMessage(f.store, msg({ text: broken, messageId: 9 }));
    expect(r.action).toBe("review");
    expect(f.records[0]).toMatchObject({ kind: "unreadable", status: "review" });
    expect(f.trades.size).toBe(0);
  });

  it("updates the plan when the signal is edited before any result", async () => {
    const f = await withSignal(TIG, 5);
    const r = await ingestFeedMessage(f.store, msg({ text: TIG.replace("SL: 4360", "SL: 4362"), messageId: 5, edited: true }));
    expect(r).toEqual({ action: "signal_updated", tradeId: "t1" });
    expect(f.trades.get("t1")?.stop_loss).toBe(4362);
  });

  it("keeps a signal edited into a cancellation for a person, and the trade stays", async () => {
    const f = await withSignal(TIG, 5);
    const r = await ingestFeedMessage(f.store, msg({ text: "❌ CANCELLED — do not take this one", messageId: 5, edited: true }));
    expect(r).toMatchObject({ action: "review" });
    expect(f.records.at(-1)?.reason).toMatch(/edited into something else/);
    expect(f.trades.size).toBe(1);
  });

  it("does nothing in a room with no feed, or a paused one", async () => {
    expect(await ingestFeedMessage(fake({}, null).store, msg({ text: YOHAN }))).toEqual({ action: "skipped", why: "no_feed" });
    expect(await ingestFeedMessage(fake({}, { ...feed, enabled: false }).store, msg({ text: YOHAN }))).toEqual({ action: "skipped", why: "disabled" });
  });

  it("finds a topic's feed, and falls back to the whole chat's", async () => {
    const topicFeed = { ...feed, threadId: 42 };
    const f = fake({}, topicFeed);
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN, threadId: 42 }))).action).toBe("signal_logged");
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN, threadId: 43, messageId: 2 }))).action).toBe("skipped");
    const whole = fake({}, feed);
    expect((await ingestFeedMessage(whole.store, msg({ text: YOHAN, threadId: 43 }))).action).toBe("signal_logged");
  });
});

describe("results", () => {
  it("marks the target hit on the trade the reply answers, closes it there, with the currency", async () => {
    const f = await withSignal();
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips\nYou can protect at BE", messageId: 23, replyToMessageId: 21, postedAt: "2026-09-04T15:00:00.000Z" }));
    expect(r).toEqual({ action: "result_applied", tradeId: "t1", closed: true, react: false });
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("hit");
    expect(t.exit_price).toBe(163.63);
    expect(t.pnl_absolute).toBeGreaterThan(0);
    expect(t.exit_time).toBe("2026-09-04T15:00:00.000Z");
    expect(f.updates.at(-1)?.[1]).toHaveProperty("pnl_currency");
    expect(f.updates.at(-1)?.[1]).toHaveProperty("pnl_rate_quality");
  });

  it("banks targets in order, closes at the furthest, and moves the close time with it", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21, postedAt: "2026-09-04T15:00:00.000Z" }));
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP3 HIT +30 pips", messageId: 24, replyToMessageId: 21, postedAt: "2026-09-04T22:00:00.000Z" }));
    const t = f.trades.get("t1")!;
    expect([t.tp1_result, t.tp2_result, t.tp3_result]).toEqual(["hit", "hit", "hit"]);
    expect(t.exit_price).toBe(163.43);
    expect(t.exit_time).toBe("2026-09-04T22:00:00.000Z");
  });

  it("puts a stop after a hit on the runner, and the banked exit stands", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 24, replyToMessageId: 21 }));
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("hit");
    expect(t.tp2_result).toBe("sl");
    expect(t.exit_price).toBe(163.63);
  });

  it("a stop with nothing banked closes the trade at the stop", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 23, replyToMessageId: 21 }));
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("sl");
    expect(t.exit_price).toBe(163.83);
    expect(t.pnl_absolute).toBeLessThan(0);
  });

  it("never turns a recorded loss into a win: a later hit goes to review", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 23, replyToMessageId: 21 }));
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP2 HIT +20 pips", messageId: 24, replyToMessageId: 21 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/contradicts the stop/);
    expect(f.trades.get("t1")?.tp1_result).toBe("sl");
  });

  it("keeps TIG's 'close first entry at BE' while the second runs for a person, then takes the hit", async () => {
    const f = await withSignal(TIG, 5);
    const part = await ingestFeedMessage(f.store, msg({ text: "Second entry is currently running with +70 pips, Book partial 🤑✅\n\nMove SL to 4336✅\n\nClose first entry at BE✅", messageId: 6, replyToMessageId: 5 }));
    expect(part.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/part of the position/);
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
    const hit = await ingestFeedMessage(f.store, msg({ text: "Tp1 hits with +60pips✅\n\nMake trade risk free if you want🤝", messageId: 7, replyToMessageId: 5 }));
    expect(hit.action).toBe("result_applied");
    expect(f.trades.get("t1")?.tp1_result).toBe("hit");
  });

  it("never turns a recorded breakeven into a loss, or a loss into a breakeven", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "Closed at BE ✅", messageId: 23, replyToMessageId: 21 }));
    expect(f.trades.get("t1")?.tp1_result).toBe("be");
    const r = await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 24, replyToMessageId: 21 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/stop reported where a breakeven/);
    expect(f.trades.get("t1")?.tp1_result).toBe("be");
  });

  it("keeps a stop that comes with its own close price for a person", async () => {
    const f = await withSignal();
    const r = await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT, closed at 163.85", messageId: 23, replyToMessageId: 21 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/stopped with a close at 163.85/);
  });

  it("treats a trade closed at a stated price as finished", async () => {
    const f = await withSignal(TIG, 5);
    expect((await ingestFeedMessage(f.store, msg({ text: "Closed at 4371 ✅", messageId: 6, replyToMessageId: 5 }))).action).toBe("result_applied");
    expect(f.trades.get("t1")?.exit_price).toBe(4371);
    expect((await ingestFeedMessage(f.store, msg({ text: "Closed at 4371 ✅", messageId: 7, replyToMessageId: 5 }))).action).toBe("noise");
    const later = await ingestFeedMessage(f.store, msg({ text: "Tp1 hits with +60pips✅", messageId: 8, replyToMessageId: 5 }));
    expect(later.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/already closed at 4371/);
    expect(f.trades.get("t1")?.exit_price).toBe(4371);
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
  });

  it("measures a single target's tolerance from the distance to entry, not a percentage", async () => {
    const one = "🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: 64350\n\n🎯 TP1: 64000\n\n🛑 SL: 64600";
    const f = await withSignal(one, 50);
    expect(f.trades.get("t1")?.tp1).toBe(64000);
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP 63900 HIT", messageId: 51, replyToMessageId: 50 }))).action).toBe("review");
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP 63990 HIT", messageId: 52, replyToMessageId: 50 }))).action).toBe("result_applied");
  });

  it("matches Chris's price-named targets to the trade's slots", async () => {
    const f = await withSignal(CHRIS, 31);
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP 63600 HIT (+800)", messageId: 34, replyToMessageId: 31 }));
    expect(r.action).toBe("result_applied");
    const t = f.trades.get("t1")!;
    expect([t.tp1_result, t.tp2_result, t.tp3_result]).toEqual(["hit", "hit", null]);
    expect(t.exit_price).toBe(63600);
  });

  it("reads a target line whose only verb is the positive result", async () => {
    const f = await withSignal(CHRIS, 31);
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP3 63300 ( +1100 pips )", messageId: 35, replyToMessageId: 31 }));
    expect(f.trades.get("t1")?.exit_price).toBe(63300);
  });

  it("keeps a price that matches no target, the entry price, or a price between targets, for a person", async () => {
    const f = await withSignal(CHRIS, 31);
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP 61000 HIT (+3300)", messageId: 36, replyToMessageId: 31 }))).action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/no target at 61000/);
    const y = await withSignal();
    expect((await ingestFeedMessage(y.store, msg({ text: "🎯 TP 163.730 HIT", messageId: 40, replyToMessageId: 21 }))).action).toBe("review");
    expect((await ingestFeedMessage(y.store, msg({ text: "🎯 TP 163.58 HIT", messageId: 41, replyToMessageId: 21 }))).action).toBe("review");
    expect(y.records.at(-1)?.reason).toMatch(/between targets/);
    expect(y.trades.get("t1")?.tp1_result).toBeNull();
  });

  it("keeps an index whose stated price disagrees with the trade for a person", async () => {
    const f = await withSignal(CHRIS, 31);
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 61000 HIT (+3300 PIPS)", messageId: 36, replyToMessageId: 31 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/TP1 was reported at 61000 but the trade's TP1 is 64000/);
  });

  it("keeps a hit reported with a negative pips figure for a person", async () => {
    const f = await withSignal(TIG, 5);
    const r = await ingestFeedMessage(f.store, msg({ text: "TP1 HIT -900 pips", messageId: 6, replyToMessageId: 5 }));
    expect(r.action).toBe("review");
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
  });

  it("keeps an explicit close after targets were hit for a person", async () => {
    const f = await withSignal(TIG, 5);
    await ingestFeedMessage(f.store, msg({ text: "Tp1 hits with +60pips✅", messageId: 6, replyToMessageId: 5 }));
    const r = await ingestFeedMessage(f.store, msg({ text: "Closed at 4371 ✅", messageId: 7, replyToMessageId: 5 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/closed at 4371 after targets were hit/);
  });

  it("follows a reply to a reply, and a reply through chat, back to the trade", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP2 HIT +20 pips", messageId: 25, replyToMessageId: 23 }))).action).toBe("result_applied");
    expect((await ingestFeedMessage(f.store, msg({ text: "nice one boss 🙏", messageId: 26, replyToMessageId: 21 }))).action).toBe("noise");
    expect(f.records.find((r) => r.messageId === 26)).toMatchObject({ kind: "noise", status: "ignored", tradeId: "t1" });
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP3 HIT +30 pips", messageId: 27, replyToMessageId: 26 }))).action).toBe("result_applied");
    expect(f.trades.get("t1")?.tp3_result).toBe("hit");
  });

  it("attaches an unlinked result to the one running trade for its instrument, even when partly banked", async () => {
    const f = await withSignal(TIG, 5);
    await ingestFeedMessage(f.store, msg({ text: "Tp1 hits with +60pips✅", messageId: 6, replyToMessageId: 5 }));
    await ingestFeedMessage(f.store, msg({ text: CHRIS, messageId: 40 }));
    const r = await ingestFeedMessage(f.store, msg({ text: "XAUUSD TP2 hit ✅ +110 pips", messageId: 41 }));
    expect(r).toMatchObject({ action: "result_applied", tradeId: "t1" });
    expect(f.trades.get("t1")?.tp2_result).toBe("hit");
    expect(f.trades.get("t2")?.tp1_result).toBeNull();
  });

  it("asks when more than one trade is running, and when none is named and several run", async () => {
    const f = await withSignal(TIG, 5);
    await ingestFeedMessage(f.store, msg({ text: TIG.replace("4374", "4372"), messageId: 8 }));
    expect((await ingestFeedMessage(f.store, msg({ text: "XAUUSD TP1 hit", messageId: 9 }))).action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/more than one XAUUSD trade/);
    expect((await ingestFeedMessage(f.store, msg({ text: "SL HIT ❌", messageId: 10 }))).action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/no instrument named/);
    const one = await withSignal(TIG, 5);
    expect((await ingestFeedMessage(one.store, msg({ text: "SL HIT ❌", messageId: 10 }))).action).toBe("result_applied");
  });

  it("keeps a result with nothing open for a person, and retries it once the signal is there", async () => {
    const f = fake();
    const early = msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 });
    expect(await ingestFeedMessage(f.store, early)).toEqual({ action: "review", reason: "a result with no open trade to attach to" });
    await ingestFeedMessage(f.store, msg({ text: YOHAN, messageId: 21 }));
    expect(await ingestFeedMessage(f.store, early)).toEqual({ action: "skipped", why: "seen" });
    expect((await ingestFeedMessage(f.store, early, { force: true })).action).toBe("result_applied");
  });

  it("takes results only from a trader of the room, or from the channel itself", async () => {
    const f = await withSignal();
    const stranger = await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 23, replyToMessageId: 21, sender: "Random Member", senderId: 777 }));
    expect(stranger.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/has not posted a signal/);
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
    const channel = await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 24, replyToMessageId: 21, sender: "TIG master channel", senderId: null }));
    expect(channel.action).toBe("result_applied");
  });

  it("ignores a repeated update that changes nothing, and advice that is not a result", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 24, replyToMessageId: 21 }))).action).toBe("noise");
    expect(f.records.at(-1)).toMatchObject({ status: "ignored" });
    expect((await ingestFeedMessage(f.store, msg({ text: "Make trade risk free if you want🤝", messageId: 26, replyToMessageId: 21 }))).action).toBe("noise");
    expect((await ingestFeedMessage(f.store, msg({ text: "Ready", messageId: 27 }))).action).toBe("noise");
  });

  it("leaves an applied result alone when re-edited unchanged, and asks when it changed", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect(await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21, edited: true }))).toEqual({ action: "skipped", why: "seen" });
    expect(f.records.find((r) => r.messageId === 23)?.status).toBe("applied");
    expect((await ingestFeedMessage(f.store, msg({ text: "🎯 TP2 HIT +20 pips", messageId: 23, replyToMessageId: 21, edited: true }))).action).toBe("review");
    expect(f.records.find((r) => r.messageId === 23)?.status).toBe("review");
    expect(f.trades.get("t1")?.tp2_result).toBeNull();
  });

  it("asks when a result names more than one instrument", async () => {
    const f = await withSignal(TIG, 5);
    const r = await ingestFeedMessage(f.store, msg({ text: "XAUUSD TP1 hit ✅ EURUSD TP1 hit ✅", messageId: 9 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/more than one instrument named/);
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
  });

  it("asks rather than pick from a window too full to have looked through", async () => {
    const f = await withSignal(TIG, 5);
    const crowd = Array.from({ length: ATTACH_CANDIDATES }, () => f.trades.get("t1")!);
    f.store.recentTrades = async () => crowd;
    const r = await ingestFeedMessage(f.store, msg({ text: "XAUUSD SL HIT ❌", messageId: 9 }));
    expect(r.action).toBe("review");
    expect(f.records.at(-1)?.reason).toMatch(/too many trades/);
  });

  it("finds only its own feed's trades, though two topics may share a journal", async () => {
    const topic5: Feed = { ...feed, id: "feed-a", threadId: 5 };
    const topic7: Feed = { ...feed, id: "feed-b", threadId: 7 };
    const f = fake({ feedFor: async (_c, t) => (t === 5 ? topic5 : t === 7 ? topic7 : null) }, topic5);
    await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5, threadId: 5 }));
    const r = await ingestFeedMessage(f.store, msg({ text: "XAUUSD SL HIT ❌", messageId: 9, threadId: 7 }));
    expect(r).toEqual({ action: "review", reason: "a result with no open trade to attach to" });
    expect(f.trades.get("t1")?.tp1_result).toBeNull();
  });

  it("keeps an edit already waiting for a person waiting", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    const changed = msg({ text: "🛑 SL HIT (-10pips)", messageId: 23, replyToMessageId: 21, edited: true });
    expect((await ingestFeedMessage(f.store, changed)).action).toBe("review");
    expect(await ingestFeedMessage(f.store, changed)).toEqual({ action: "skipped", why: "seen" });
    expect(f.trades.get("t1")?.tp1_result).toBe("hit");
    expect(f.trades.get("t1")?.tp2_result).toBeNull();
  });

  it("looks back from the message's own time, not forever", async () => {
    const f = fake();
    await ingestFeedMessage(f.store, msg({ text: YOHAN, messageId: 21, postedAt: "2026-08-28T14:00:00.000Z" }));
    const r = await ingestFeedMessage(f.store, msg({ text: "USDJPY 🛑 SL HIT", messageId: 30, postedAt: "2026-09-04T14:00:00.000Z" }));
    expect(r).toEqual({ action: "review", reason: "a result with no open trade to attach to" });
    const g = fake();
    await ingestFeedMessage(g.store, msg({ text: YOHAN, messageId: 21, postedAt: "2026-09-01T14:00:00.000Z" }));
    expect((await ingestFeedMessage(g.store, msg({ text: "USDJPY 🛑 SL HIT", messageId: 30, postedAt: "2026-09-04T14:00:00.000Z" }))).action).toBe("result_applied");
  });

  it("keeps an edit to a signal that already has results for a person", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN.replace("163.730", "163.700"), messageId: 21, edited: true }))).action).toBe("review");
  });
});

describe("guards", () => {
  it("never touches a trade outside the feed's journal, even by its message id", async () => {
    const f = await withSignal();
    const other: Feed = { ...feed, id: "feed-2", journalId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "22222222-2222-4333-8444-555555555555" };
    const g = fake({}, other);
    g.trades.set("t1", f.trades.get("t1")!);
    g.byMessage.set(21, "t1");
    const r = await ingestFeedMessage(g.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect(r).toEqual({ action: "review", reason: "a result with no open trade to attach to" });
    expect(g.updates).toHaveLength(0);
  });

  it("keeps the message when its owner can no longer write, or the check could not be made", async () => {
    const no = fake({ mayWrite: async () => false });
    expect((await ingestFeedMessage(no.store, msg({ text: YOHAN, messageId: 21 }))).action).toBe("review");
    expect(no.trades.size).toBe(0);
    const blip = fake({ mayWrite: async () => null });
    expect((await ingestFeedMessage(blip.store, msg({ text: YOHAN, messageId: 21 }))).action).toBe("review");
    expect(blip.records.at(-1)?.reason).toMatch(/couldn't check/);
  });

  it("keeps a message over the room's allowance for a person, without pausing the room", async () => {
    const f = fake({ allowWrite: async () => false });
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN, messageId: 21 }))).action).toBe("review");
    expect(f.trades.size).toBe(0);
    expect(f.records.at(-1)?.reason).toMatch(/too many/);
  });

  it("only takes a message the feed actually used, so the room keeps its commands", () => {
    expect(consumedByFeed({ action: "signal_logged", tradeId: "t", react: false })).toBe(true);
    expect(consumedByFeed({ action: "review", reason: "x" })).toBe(true);
    expect(consumedByFeed({ action: "noise" })).toBe(false);
    expect(consumedByFeed({ action: "skipped", why: "disabled" })).toBe(false);
  });

  it("asks for a mark only on what it logged, and only when the room wants one", async () => {
    const marking = fake({}, { ...feed, react: true });
    const logged = await ingestFeedMessage(marking.store, msg({ text: YOHAN, messageId: 21 }));
    expect(logged).toEqual({ action: "signal_logged", tradeId: "t1", react: true });
    expect(wantsMark(logged)).toBe(true);
    const applied = await ingestFeedMessage(marking.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }));
    expect(wantsMark(applied)).toBe(true);
    expect(wantsMark(await ingestFeedMessage(marking.store, msg({ text: "nice one boss", messageId: 24, replyToMessageId: 21 })))).toBe(false);
    expect(wantsMark(await ingestFeedMessage(marking.store, msg({ text: "🎯 TP 61000 HIT", messageId: 25, replyToMessageId: 21 })))).toBe(false);
    const quiet = await withSignal();
    expect(wantsMark(await ingestFeedMessage(quiet.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 })))).toBe(false);
  });

  it("covers a weekend", () => {
    expect(ATTACH_WINDOW_HOURS).toBeGreaterThanOrEqual(96);
  });
});

describe("applyResult and stillRunning on their own", () => {
  const base = { id: "x", instrument: "XAUUSD", direction: "buy", entry_price: 4374, exit_price: null, quantity: 50, fees: 0, stop_loss: 4360, take_profit: 4380, tp1: 4380, tp2: 4385, tp3: 4390, tp4: null, tp5: null, tp6: null, tp7: null, tp1_result: null, tp2_result: null, tp3_result: null, tp4_result: null, tp5_result: null, tp6_result: null, tp7_result: null, tp4_trailing: true, num_positions: 1, split_risk: false } as unknown as TradeRow;

  it("reports nothing new rather than rewriting", () => {
    expect(applyResult({ ...base, tp1_result: "hit" } as TradeRow, parseResultUpdate("Tp1 hits with +60pips"))).toEqual({ reason: "nothing new in that update", review: false });
  });

  it("closes at an explicit price when nothing was banked", () => {
    const r = applyResult(base, parseResultUpdate("closed at 4383"));
    expect("patch" in r && r.patch.exit_price).toBe(4383);
  });

  it("knows a partly banked trade with a runner is still running, and a stopped one is not", () => {
    expect(stillRunning(base)).toBe(true);
    expect(stillRunning({ ...base, tp1_result: "hit", exit_price: 4380 } as TradeRow)).toBe(true);
    expect(stillRunning({ ...base, tp1_result: "hit", tp2_result: "sl", exit_price: 4380 } as TradeRow)).toBe(false);
    expect(stillRunning({ ...base, tp1_result: "sl", exit_price: 4360 } as TradeRow)).toBe(false);
    expect(stillRunning({ ...base, tp1_result: "hit", tp2_result: "hit", tp3_result: "hit", tp4_trailing: false, exit_price: 4390 } as TradeRow)).toBe(false);
  });
});
