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
    allow: async () => true,
    loadOpen: async () => loaded,
    linkedUser: async (id) => (id === 111 ? U : null),
    cancelDraft: async () => {},
    editableJournals: async () => [{ id: "j1", name: "TTC GOLD" }],
    saveConversation: async (_id, c) => { saved.push(c); return true; },
    recentLots: async () => [0.5],
    topTags: async () => ["scalp"],
    isQuick: async () => quick,
    ...o,
  };
  return { store, saved };
}

const tap = (field: "s" | "d" | "e" | "t" | "k" | "c", value = "", o: Partial<{ tapperId: number; chatId: string }> = {}) => ({
  pendingId: ID, field, value, tapperId: 111, chatId: "c1", ...o,
});
/** The Skip of a given question. */
const skip = (stage: string, o: Partial<{ tapperId: number; chatId: string }> = {}) => tap("k", stage, o);

describe("refusals", () => {
  it.each([
    ["a draft that never existed", () => fake(null), skip("size"), /isn't yours or has expired/],
    ["a tap by somebody else", () => fake(open({ answers: {} })), skip("size", { tapperId: 222 }), /isn't yours or has expired/],
    ["a forwarded question", () => fake(open({ answers: {} })), skip("size", { chatId: "elsewhere" }), /own chat/],
    ["a revoked link", () => fake(open({ answers: {} }), { linkedUser: async () => null }), skip("size"), /no longer linked/],
  ])("refuses %s", async (_n, make, t, re) => {
    const f = make();
    const r = await handleTradeAnswer(f.store, t, NOW);
    expect(r.answer).toMatch(re);
    expect(r.alert).toBe(true);
    expect(f.saved).toHaveLength(0);
  });

  it("says a finished draft is finished", async () => {
    const f = fake(open({ answers: {} }, { consumedAt: "2026-09-03T13:59:00Z" }));
    const r = await handleTradeAnswer(f.store, skip("size"), NOW);
    expect(r.answer).toMatch(/finished/);
    expect(r.clearPicker).toBe(true);
  });

  it("points at the picker once the questions are done", async () => {
    const f = fake(open({ answers: { lots: 1 }, ready: true }));
    const r = await handleTradeAnswer(f.store, skip("notes"), NOW);
    expect(r.answer).toMatch(/Pick a journal/);
  });

  it("stays quiet when over the allowance, before reading anything", async () => {
    let loaded = 0;
    const f = fake(open({ answers: {} }), { allow: async () => false, loadOpen: async () => { loaded += 1; return null; } });
    const r = await handleTradeAnswer(f.store, skip("size"), NOW);
    expect(r.answer).toBe("");
    expect(loaded).toBe(0);
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
    const r = await handleTradeAnswer(f.store, skip("emotion"), NOW);
    expect(f.saved[0].answers.emotion).toBeNull();
    expect(r.reply?.text).toMatch(/Tags\?/);
    expect(r.reply?.buttons?.map((b) => b.text)).toEqual(["scalp", "Skip"]);
  });

  it("ends with the summary and the picker", async () => {
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm", tags: ["scalp"] } }));
    const r = await handleTradeAnswer(f.store, skip("notes"), NOW);
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

  it("does not let an earlier prompt's Skip skip the open question", async () => {
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm" } }));
    const r = await handleTradeAnswer(f.store, skip("emotion"), NOW);
    expect(f.saved.every((c) => c.answers.tags === undefined)).toBe(true);
    expect(r.reply?.text).toMatch(/Tags\?/);
  });

  it("says so when the answer could not be held, rather than showing a dead picker", async () => {
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm", tags: [] } }), {
      saveConversation: async () => false,
    });
    const r = await handleTradeAnswer(f.store, skip("notes"), NOW);
    expect(r.answer).toMatch(/Couldn't hold/);
    expect(r.reply).toBeUndefined();
  });

  it("drops the draft when no journal is left to offer", async () => {
    const cancelled: string[] = [];
    const f = fake(open({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: "calm", tags: [] } }), {
      editableJournals: async () => [],
      cancelDraft: async (id) => { cancelled.push(id); },
    });
    const r = await handleTradeAnswer(f.store, skip("notes"), NOW);
    expect(r.reply?.text).toMatch(/nowhere to go/);
    expect(cancelled).toEqual([ID]);
  });
});

describe("confirming a prose reading by button", () => {
  it("cancels on No and continues on Yes", async () => {
    const cancelled: string[] = [];
    const proseDraft = { ...draft(), read_from_prose: true };
    const no = fake(open({ answers: {} }, { draft: proseDraft }), { cancelDraft: async (id) => { cancelled.push(id); } });
    const r = await handleTradeAnswer(no.store, tap("c", "no"), NOW);
    expect(cancelled).toEqual([ID]);
    expect(r.reply?.text).toMatch(/Cancelled/);

    const yes = fake(open({ answers: {} }, { draft: proseDraft }));
    const r2 = await handleTradeAnswer(yes.store, tap("c", "yes"), NOW);
    expect(yes.saved[0].confirmed).toBe(true);
    expect(r2.reply?.text).toMatch(/Size in lots\?/);
  });
});
