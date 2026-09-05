import { describe, expect, it } from "vitest";
import { ingestFeedMessage, applyResult, type Feed, type FeedMessage, type FeedStore, type MessageRecord, type TradeRow } from "@/lib/telegram/feed";
import { parseResultUpdate } from "@/lib/telegram/result-update";

/**
 * The listener, end to end over a fake store, with messages taken verbatim
 * from the four rooms' exports. Nobody confirms anything here, so the
 * assertions are on what lands in the journal and on what is kept for a
 * person instead.
 */

const NOW = new Date("2026-09-05T10:00:00Z");
const U = "11111111-2222-4333-8444-555555555555";
const J = "aaaaaaaa-0000-4000-8000-000000000001";

const feed: Feed = { id: "feed-1", chatId: "-100999", threadId: null, journalId: J, userId: U, defaultLots: 0.5, enabled: true, react: false };

function msg(o: Partial<FeedMessage> & { text: string }): FeedMessage {
  return { chatId: "-100999", messageId: 1, threadId: null, replyToMessageId: null, sender: "Yohan Morel", postedAt: "2026-09-04T14:00:00.000Z", edited: false, ...o };
}

interface Fake { store: FeedStore; trades: Map<string, TradeRow>; byMessage: Map<number, string>; records: MessageRecord[]; updates: [string, Record<string, unknown>][] }

function fake(o: Partial<FeedStore> = {}, f: Feed | null = feed): Fake {
  const trades = new Map<string, TradeRow>();
  const byMessage = new Map<number, string>();
  const records: MessageRecord[] = [];
  const updates: [string, Record<string, unknown>][] = [];
  let n = 0;
  const store: FeedStore = {
    feedFor: async (chatId, threadId) => (f && f.chatId === chatId && f.threadId === threadId ? f : null),
    seen: async (_c, id) => { const r = records.find((x) => x.messageId === id); return r ? { kind: r.kind, status: r.status, tradeId: r.tradeId } : null; },
    record: async (r) => { records.push(r); },
    tradeByMessage: async (_c, id) => { const t = byMessage.get(id); return t ? (trades.get(t) ?? null) : null; },
    tradeById: async (id) => trades.get(id) ?? null,
    latestOpenTrade: async (_j, instrument) => {
      const open = [...trades.values()].filter((t) => t.exit_price === null && !t.tp1_result && (!instrument || t.instrument === instrument));
      return open.at(-1) ?? null;
    },
    insertTrade: async (row) => {
      n += 1;
      const id = `t${n}`;
      trades.set(id, { id, exit_time: null, ...row } as unknown as TradeRow);
      byMessage.set(row.telegram_message_id as number, id);
      return { id };
    },
    updateTrade: async (id, patch) => {
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

describe("a signal", () => {
  it("becomes an open trade in the feed's journal, sized by the feed, dated by the message", async () => {
    const f = fake();
    const r = await ingestFeedMessage(f.store, msg({ text: YOHAN, messageId: 21 }), NOW);
    expect(r).toEqual({ action: "signal_logged", tradeId: "t1" });
    const t = f.trades.get("t1") as unknown as Record<string, unknown>;
    expect(t).toMatchObject({
      user_id: U, journal_id: J, source: "telegram",
      instrument: "USDJPY", direction: "sell", entry_price: 163.73, stop_loss: 163.83,
      tp1: 163.63, tp2: 163.53, tp3: 163.43, tp4_trailing: true,
      lot_size: 0.5, quantity: 50000, entry_time: "2026-09-04T14:00:00.000Z",
      exit_price: null, telegram_chat_id: "-100999", telegram_message_id: 21,
    });
    expect(String(t.notes)).toContain("From Telegram (Yohan Morel): 🔴 SELL: USD/JPY");
    expect(f.records[0]).toMatchObject({ kind: "signal", status: "applied", tradeId: "t1", messageId: 21 });
  });

  it("is logged once however often Telegram delivers it", async () => {
    const f = fake();
    await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5 }), NOW);
    const again = await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5 }), NOW);
    expect(again).toEqual({ action: "skipped", why: "seen" });
    expect(f.trades.size).toBe(1);
  });

  it("keeps the second entry as a note and gold's 100 oz a lot", async () => {
    const f = fake();
    await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5, sender: null }), NOW);
    const t = f.trades.get("t1") as unknown as Record<string, unknown>;
    expect(t.quantity).toBe(50);
    expect(String(t.notes)).toContain("Second entry: 4369");
    expect(t.tp4_trailing).toBe(true);
  });

  it("keeps a signal the grammar refuses for a person, with the reason", async () => {
    const broken = "🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: 64500-64600\n\n🎯 TP1: 64200 (+400)\n🎯 TP2: 63800 (+800)\n🎯 TP3: 63500 (+1100)\n🎯 FINAL TP: Open\n\n🛑 SL: 64100 (-500)";
    const f = fake();
    const r = await ingestFeedMessage(f.store, msg({ text: broken, messageId: 9 }), NOW);
    expect(r.action).toBe("review");
    expect(f.records[0]).toMatchObject({ kind: "unreadable", status: "review" });
    expect(f.records[0].reason).toMatch(/stop should be above/);
    expect(f.trades.size).toBe(0);
  });

  it("updates the plan when the signal is edited before any result", async () => {
    const f = fake();
    await ingestFeedMessage(f.store, msg({ text: TIG, messageId: 5 }), NOW);
    const r = await ingestFeedMessage(f.store, msg({ text: TIG.replace("SL: 4360", "SL: 4362"), messageId: 5, edited: true }), NOW);
    expect(r).toEqual({ action: "signal_updated", tradeId: "t1" });
    expect(f.trades.get("t1")?.stop_loss).toBe(4362);
  });

  it("does nothing in a room with no feed, or a disabled one", async () => {
    expect(await ingestFeedMessage(fake({}, null).store, msg({ text: YOHAN }), NOW)).toEqual({ action: "skipped", why: "no_feed" });
    expect(await ingestFeedMessage(fake({}, { ...feed, enabled: false }).store, msg({ text: YOHAN }), NOW)).toEqual({ action: "skipped", why: "disabled" });
  });

  it("finds a topic's feed, and falls back to the whole chat's", async () => {
    const topicFeed = { ...feed, threadId: 42 };
    const f = fake({}, topicFeed);
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN, threadId: 42 }), NOW)).action).toBe("signal_logged");
    expect((await ingestFeedMessage(f.store, msg({ text: YOHAN, threadId: 43, messageId: 2 }), NOW)).action).toBe("skipped");
    const whole = fake({}, feed);
    expect((await ingestFeedMessage(whole.store, msg({ text: YOHAN, threadId: 43 }), NOW)).action).toBe("signal_logged");
  });
});

describe("results", () => {
  async function withSignal(text = YOHAN, id = 21) {
    const f = fake();
    await ingestFeedMessage(f.store, msg({ text, messageId: id }), NOW);
    return f;
  }

  it("marks the target hit on the trade the reply answers, and closes it there", async () => {
    const f = await withSignal();
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips\nYou can protect at BE", messageId: 23, replyToMessageId: 21, postedAt: "2026-09-04T15:00:00.000Z" }), NOW);
    expect(r).toEqual({ action: "result_applied", tradeId: "t1", closed: true });
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("hit");
    expect(t.exit_price).toBe(163.63);
    expect(t.pnl_absolute).toBeGreaterThan(0);
    expect(t.exit_time).toBe("2026-09-04T15:00:00.000Z");
  });

  it("banks targets in order and closes at the furthest", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }), NOW);
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP3 HIT +30 pips", messageId: 24, replyToMessageId: 21 }), NOW);
    const t = f.trades.get("t1")!;
    expect([t.tp1_result, t.tp2_result, t.tp3_result]).toEqual(["hit", "hit", "hit"]);
    expect(t.exit_price).toBe(163.43);
  });

  it("puts a stop after a hit on the runner, and the banked exit stands", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }), NOW);
    await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 24, replyToMessageId: 21 }), NOW);
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("hit");
    expect(t.tp2_result).toBe("sl");
    expect(t.exit_price).toBe(163.63);
  });

  it("a stop with nothing banked closes the trade at the stop", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🛑 SL HIT (-10pips)", messageId: 23, replyToMessageId: 21 }), NOW);
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("sl");
    expect(t.exit_price).toBe(163.83);
    expect(t.pnl_absolute).toBeLessThan(0);
  });

  it("reads TIG's 'close first entry at BE' then the hit that follows", async () => {
    const f = await withSignal(TIG, 5);
    await ingestFeedMessage(f.store, msg({ text: "Second entry is currently running with +70 pips, Book partial 🤑✅\n\nMove SL to 4336✅\n\nClose first entry at BE✅", messageId: 6, replyToMessageId: 5 }), NOW);
    expect(f.trades.get("t1")?.tp1_result).toBe("be");
    await ingestFeedMessage(f.store, msg({ text: "Tp1 hits with +60pips✅\n\nMake trade risk free if you want🤝", messageId: 7, replyToMessageId: 5 }), NOW);
    const t = f.trades.get("t1")!;
    expect(t.tp1_result).toBe("hit");
    expect(t.exit_price).toBe(4380);
  });

  it("matches Chris's price-named targets to the trade's slots", async () => {
    const f = await withSignal(CHRIS, 31);
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP 63600 HIT (+800)", messageId: 34, replyToMessageId: 31 }), NOW);
    expect(r.action).toBe("result_applied");
    const t = f.trades.get("t1")!;
    expect([t.tp1_result, t.tp2_result, t.tp3_result]).toEqual(["hit", "hit", null]);
    expect(t.exit_price).toBe(63600);
  });

  it("reads a target line whose only verb is the positive result", async () => {
    const f = await withSignal(CHRIS, 31);
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP3 63300 ( +1100 pips )", messageId: 35, replyToMessageId: 31 }), NOW);
    expect(f.trades.get("t1")?.exit_price).toBe(63300);
  });

  it("keeps a price that matches no target for a person", async () => {
    const f = await withSignal(CHRIS, 31);
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP 61000 HIT (+3300)", messageId: 36, replyToMessageId: 31 }), NOW);
    expect(r.action).toBe("review");
    expect(f.records.at(-1)).toMatchObject({ kind: "result", status: "review" });
    expect(f.records.at(-1)?.reason).toMatch(/no target at 61000/);
  });

  it("follows a reply to a reply back to the trade", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }), NOW);
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP2 HIT +20 pips", messageId: 25, replyToMessageId: 23 }), NOW);
    expect(r.action).toBe("result_applied");
    expect(f.trades.get("t1")?.tp2_result).toBe("hit");
  });

  it("attaches a result with no reply link to the open trade for its instrument", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: CHRIS, messageId: 40 }), NOW);
    const r = await ingestFeedMessage(f.store, msg({ text: "USDJPY TP1 hit", messageId: 41 }), NOW);
    expect(r).toMatchObject({ action: "result_applied", tradeId: "t1" });
  });

  it("keeps a result with nothing open for a person", async () => {
    const f = fake();
    const r = await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23 }), NOW);
    expect(r).toEqual({ action: "review", reason: "a result with no open trade to attach to" });
  });

  it("ignores a repeated update that changes nothing, and advice that is not a result", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }), NOW);
    const again = await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 24, replyToMessageId: 21 }), NOW);
    expect(again.action).toBe("noise");
    expect(f.records.at(-1)).toMatchObject({ status: "ignored" });
    const advice = await ingestFeedMessage(f.store, msg({ text: "Make trade risk free if you want🤝", messageId: 26, replyToMessageId: 21 }), NOW);
    expect(advice.action).toBe("noise");
    const chat = await ingestFeedMessage(f.store, msg({ text: "Ready", messageId: 27 }), NOW);
    expect(chat.action).toBe("noise");
  });

  it("keeps an edit to a signal that already has results for a person", async () => {
    const f = await withSignal();
    await ingestFeedMessage(f.store, msg({ text: "🎯 TP1 HIT +10 pips", messageId: 23, replyToMessageId: 21 }), NOW);
    const r = await ingestFeedMessage(f.store, msg({ text: YOHAN.replace("163.730", "163.700"), messageId: 21, edited: true }), NOW);
    expect(r.action).toBe("review");
  });
});

describe("applyResult on its own", () => {
  const base = { id: "x", instrument: "XAUUSD", direction: "buy", entry_price: 4374, exit_price: null, quantity: 50, fees: 0, stop_loss: 4360, take_profit: 4380, tp1: 4380, tp2: 4385, tp3: 4390, tp4: null, tp5: null, tp6: null, tp7: null, tp1_result: null, tp2_result: null, tp3_result: null, tp4_result: null, tp5_result: null, tp6_result: null, tp7_result: null, num_positions: 1, split_risk: false } as unknown as TradeRow;

  it("reports nothing new rather than rewriting", () => {
    const r = applyResult({ ...base, tp1_result: "hit" } as TradeRow, parseResultUpdate("Tp1 hits with +60pips"));
    expect(r).toEqual({ reason: "nothing new in that update" });
  });

  it("closes at an explicit price when nothing was banked", () => {
    const r = applyResult(base, parseResultUpdate("closed at 4383"));
    expect("patch" in r && r.patch.exit_price).toBe(4383);
  });
});
