import { describe, expect, it } from "vitest";
import { handleTradeAnswer, type TradeAnswerStore } from "@/lib/telegram/trade-answer";
import type { Conversation } from "@/lib/telegram/conversation";
import type { OpenDraft } from "@/lib/telegram/trade-flow";
import type { TradeDraft } from "@/lib/telegram/trade-intent";

const NOW = new Date("2026-09-03T14:00:00Z");
const U = "11111111-2222-4333-8444-555555555555";
const ID = "aB3_x-9Q";

const draft = (o: Partial<TradeDraft> = {}): TradeDraft => ({
  instrument: "XAUUSD", asset_type: "metal", direction: "buy", entry_price: 3340,
  entry_price_high: null, stop_loss: 3335,
  tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
  tp4_trailing: false, outcome: { kind: "closed_at", exit_price: 3348 },
  entry_time: NOW.toISOString(), dated_from_text: false, date_label: null, lots: null,
  message: "XAUUSD buy 3340 sl 3335 closed 3348", ...o,
});

type Loaded = OpenDraft & { consumedAt: string | null };
const open = (conversation: Conversation, o: Partial<Loaded> = {}): Loaded => ({
  id: ID, telegramUserId: 111, userId: U, chatId: "c1", draft: draft(), journalIds: ["j1"],
  conversation, expiresAt: "2026-09-03T14:30:00.000Z", consumedAt: null, ...o,
});

function fake(loaded: Loaded | null, o: Partial<TradeAnswerStore> = {}, quick = false) {
  const saved: Conversation[] = [];
  const store: TradeAnswerStore = {
    loadOpen: async () => loaded,
    linkedUser: async (id) => (id === 111 ? U : null),
    editableJournals: async () => [{ id: "j1", name: "TTC GOLD" }],
    saveConversation: async (_id, c) => { saved.push(c); },
    recentLots: async () => [0.5],
    topTags: async () => ["scalp"],
    isQuick: async () => quick,
    ...o,
  };
  return { store, saved };
}

const tap = (field: "s" | "d" | "e" | "t" | "k", value = "", o: Partial<{ tapperId: number; chatId: string }> = {}) => ({
  pendingId: ID, field, value, tapperId: 111, chatId: "c1", ...o,
});

describe("refusals", () => {
  it.each([
    ["a draft that never existed", () => fake(null), tap("k"), /expired/],
    ["a tap by somebody else", () => fake(open({ answers: {} })), tap("k", "", { tapperId: 222 }), /isn't your trade/],
    ["a forwarded question", () => fake(open({ answers: {} })), tap("k", "", { chatId: "elsewhere" }), /own chat/],
    ["a revoked link", () => fake(open({ answers: {} }), { linkedUser: async () => null }), tap("k"), /no longer linked/],
  ])("refuses %s", async (_n, make, t, re) => {
    const f = make();
    const r = await handleTradeAnswer(f.store, t, NOW);
    expect(r.answer).toMatch(re);
    expect(r.alert).toBe(true);
    expect(f.saved).toHaveLength(0);
  });

  it("says a finished draft is finished", async () => {
    const f = fake(open({ answers: {} }, { consumedAt: "2026-09-03T13:59:00Z" }));
    const r = await handleTradeAnswer(f.store, tap("k"), NOW);
    expect(r.answer).toMatch(/finished/);
    expect(r.clearPicker).toBe(true);
  });

  it("points at the picker once the questions are done", async () => {
    const f = fake(open({ answers: { lots: 1 }, ready: true }));
    const r = await handleTradeAnswer(f.store, tap("k"), NOW);
    expect(r.answer).toMatch(/Pick a journal/);
  });
});

describe("answers", () => {
  it("takes an offered size and asks for the date", async () => {
    const f = fake(open({ answers: {}, offeredLots: [0.5] }));
    const r = await handleTradeAnswer(f.store, tap("s", "0.5"), NOW);
    expect(r.answer).toBe("");
    expect(r.clearPicker).toBe(true);
    expect(f.saved[0].answers.lots).toBe(0.5);
    expect(r.reply?.text).toMatch(/When was it\?/);
  });

  it("refuses a size that was never offered, out loud", async () => {
    const f = fake(open({ answers: {}, offeredLots: [0.5] }));
    const r = await handleTradeAnswer(f.store, tap("s", "50"), NOW);
    expect(r.alert).toBe(true);
    expect(f.saved).toHaveLength(0);
  });

  it("skips a mood and asks for tags", async () => {
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString() } }));
    const r = await handleTradeAnswer(f.store, tap("k"), NOW);
    expect(f.saved[0].answers.emotion).toBeNull();
    expect(r.reply?.text).toMatch(/Tags\?/);
    expect(r.reply?.buttons?.map((b) => b.text)).toEqual(["scalp", "Skip"]);
  });

  it("ends with the summary and the picker", async () => {
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm", tags: ["scalp"] } }));
    const r = await handleTradeAnswer(f.store, tap("k"), NOW);
    expect(f.saved[0].answers.notes).toBeNull();
    expect(r.reply?.text).toMatch(/Mood: calm/);
    expect(r.reply?.text).toMatch(/Which journal\?/);
    expect(r.reply?.buttons?.map((b) => b.text)).toEqual(["TTC GOLD", "Cancel"]);
    expect(f.saved.at(-1)?.ready).toBe(true);
  });

  it("re-sends the open question when an old button is tapped again", async () => {
    // Emotion already answered; its button tapped a second time.
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm" } }));
    const r = await handleTradeAnswer(f.store, tap("e", "calm"), NOW);
    expect(r.answer).toBe("");
    expect(r.clearPicker).toBe(true);
    expect(r.reply?.text).toMatch(/Tags\?/);
  });
});
