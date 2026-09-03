import { describe, expect, it, vi } from "vitest";
import {
  handleTradeMessage,
  PENDING_TTL_MINUTES,
  type DraftToHold,
  type TradeDmStore,
} from "@/lib/telegram/trade-dm";
import { decodeTrade } from "@/lib/telegram/commands";
import { decodeAnswer, type Conversation } from "@/lib/telegram/conversation";
import type { OpenDraft } from "@/lib/telegram/trade-flow";
import type { TradeDraft } from "@/lib/telegram/trade-intent";

const NOW = new Date("2026-09-03T14:00:00Z");
const U = "11111111-2222-4333-8444-555555555555";
const TRADE = "XAUUSD buy 3340 sl 3335 closed 3348";

const draft = (o: Partial<TradeDraft> = {}): TradeDraft => ({
  instrument: "XAUUSD",
  asset_type: "metal",
  direction: "buy",
  entry_price: 3340,
  entry_price_high: null,
  stop_loss: 3335,
  tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
  tp4_trailing: false,
  outcome: { kind: "closed_at", exit_price: 3348 },
  entry_time: NOW.toISOString(),
  dated_from_text: false,
  date_label: null,
  lots: null,
  message: TRADE,
  ...o,
});

const openDraft = (conversation: Conversation = { answers: {} }, o: Partial<OpenDraft> = {}): OpenDraft => ({
  id: "aB3_x-9Q",
  telegramUserId: 111,
  userId: U,
  chatId: "c1",
  draft: draft(),
  journalIds: ["j1", "j2"],
  conversation,
  expiresAt: "2026-09-03T14:30:00.000Z",
  ...o,
});

function fake(o: Partial<TradeDmStore> = {}, opts: { open?: OpenDraft | null; quick?: boolean } = {}) {
  const held: DraftToHold[] = [];
  const saved: [string, Conversation][] = [];
  const cancelled: string[] = [];
  let quick = opts.quick ?? false;
  let open: OpenDraft | null = opts.open ?? null;
  const allow = vi.fn(async () => true);
  const store: TradeDmStore = {
    allow,
    linkedUser: async (id) => (id === 111 ? U : null),
    editableJournals: async () => [
      { id: "j1", name: "TTC GOLD | SCALP" },
      { id: "j2", name: "TTC FOREX" },
    ],
    newPendingId: () => "aB3_x-9Q",
    holdDraft: async (d) => {
      held.push(d);
      return true;
    },
    openDraft: async () => open,
    cancelDraft: async (id) => {
      cancelled.push(id);
      open = null;
    },
    setQuick: async (_id, q) => {
      quick = q;
    },
    isQuick: async () => quick,
    saveConversation: async (id, c) => {
      saved.push([id, c]);
      return true;
    },
    saveDraft: async () => true,
    recentLots: async () => [0.5, 1],
    topTags: async () => ["scalp"],
    ...o,
  };
  return { store, held, saved, cancelled, allow, quickState: () => quick };
}

const msg = (text: string, telegramUserId = 111) => ({ text, telegramUserId, chatId: "c1" });

describe("first contact and commands", () => {
  it("answers /start and plain greetings with how to link, when not linked", async () => {
    const f = fake();
    for (const t of ["/start", "hey", "Hello!"]) {
      const r = await handleTradeMessage(f.store, msg(t, 999), NOW);
      expect(r?.text).toMatch(/Settings → Telegram/);
      expect(r?.text).toMatch(/XAUUSD buy 3340/);
    }
  });

  it("answers /help without the linking step, when linked", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("/help"), NOW);
    expect(r?.text).not.toMatch(/First, link/);
    expect(r?.text).toMatch(/\/quick/);
  });

  it("tells a DM'd report command where reports go", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("/daily"), NOW);
    expect(r?.text).toMatch(/connected group/);
  });

  it("toggles quick mode per person", async () => {
    const f = fake();
    expect((await handleTradeMessage(f.store, msg("/quick"), NOW))?.text).toMatch(/Quick mode on/);
    expect(f.quickState()).toBe(true);
    expect((await handleTradeMessage(f.store, msg("/quick"), NOW))?.text).toMatch(/Quick mode off/);
    expect(f.quickState()).toBe(false);
  });

  it("asks an unlinked person to link before /quick", async () => {
    const f = fake();
    expect((await handleTradeMessage(f.store, msg("/quick", 999), NOW))?.text).toMatch(/Settings → Telegram/);
  });

  it("cancels the draft being asked about, or says there is none", async () => {
    const none = fake();
    expect((await handleTradeMessage(none.store, msg("/cancel"), NOW))?.text).toBe("Nothing to cancel.");
    const f = fake({}, { open: openDraft() });
    expect((await handleTradeMessage(f.store, msg("/cancel"), NOW))?.text).toMatch(/Cancelled/);
    expect(f.cancelled).toEqual(["aB3_x-9Q"]);
  });
});

describe("silence", () => {
  it("says nothing to chat, and does not even count it", async () => {
    const f = fake();
    expect(await handleTradeMessage(f.store, msg("thanks!"), NOW)).toBeNull();
    expect(f.allow).not.toHaveBeenCalled();
  });

  it("says nothing when over the allowance", async () => {
    const f = fake({ allow: async () => false });
    expect(await handleTradeMessage(f.store, msg(TRADE), NOW)).toBeNull();
    expect(f.held).toHaveLength(0);
  });
});

describe("a new trade", () => {
  it("asks an unlinked sender to link, without holding anything", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg(TRADE, 999), NOW);
    expect(r?.text).toMatch(/Settings → Telegram/);
    expect(f.held).toHaveLength(0);
  });

  it("lists what is missing", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335"), NOW);
    expect(r?.text).toMatch(/Not yet/);
    expect(r?.text).toMatch(/what happened/);
    expect(f.held).toHaveLength(0);
  });

  it("refuses when the account can write nowhere", async () => {
    const f = fake({ editableJournals: async () => [] });
    const r = await handleTradeMessage(f.store, msg(TRADE), NOW);
    expect(r?.text).toMatch(/nowhere to put/);
    expect(f.held).toHaveLength(0);
  });

  it("holds the draft and asks the first question, showing what it understood", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg(TRADE), NOW);
    expect(f.held).toHaveLength(1);
    const d = f.held[0];
    expect(d.userId).toBe(U);
    expect(d.journalIds).toEqual(["j1", "j2"]);
    expect(d.expiresAt).toBe(new Date(NOW.getTime() + PENDING_TTL_MINUTES * 60_000).toISOString());
    expect(d.draft.message).toBe(TRADE);

    expect(r?.text).toMatch(/\+80[.,]0 pips/);
    expect(r?.text).toMatch(/Size in lots\?/);
    expect(decodeAnswer(r?.buttons?.[0].callback_data)).toEqual({ pendingId: "aB3_x-9Q", field: "s", value: "0.5" });
    expect(f.saved.at(-1)?.[1].offeredLots).toEqual([0.5, 1]);
    expect(r?.buttons?.map((b) => b.text)).toEqual(["0.5 lots", "1 lot"]);
  });

  it("goes straight to the journal picker when nothing is missing and quick mode is on", async () => {
    const f = fake({}, { quick: true });
    const r = await handleTradeMessage(f.store, msg(`${TRADE} 0.5 lots yesterday`), NOW);
    expect(r?.text).toMatch(/Which journal\?/);
    expect(r?.text).toMatch(/0\.5 lots/);
    expect(r?.text).toMatch(/yesterday/);
    expect(r?.buttons?.map((b) => b.text)).toEqual(["TTC GOLD | SCALP", "TTC FOREX", "Cancel"]);
    expect(decodeTrade(r?.buttons?.[1].callback_data)).toEqual({ pendingId: "aB3_x-9Q", journalIndex: 1 });
    expect(f.saved.at(-1)?.[1].ready).toBe(true);
  });

  it("asks how it felt when size and date were typed and quick mode is off", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg(`${TRADE} 0.5 lots yesterday`), NOW);
    expect(r?.text).toMatch(/How did it feel/);
    expect(r?.buttons).toHaveLength(13);
    expect(r?.perRow).toBe(3);
  });

  it("flags an open trade as not countable on the picker", async () => {
    const f = fake({}, { quick: true });
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 tp1 3350 still open 1 lot today"), NOW);
    expect(r?.text).toMatch(/won't appear on a poster/);
  });

  it("says so when the draft could not be held", async () => {
    const f = fake({ holdDraft: async () => false });
    const r = await handleTradeMessage(f.store, msg(TRADE), NOW);
    expect(r?.text).toMatch(/Couldn't hold/);
  });
});

describe("answering the open question by typing", () => {
  it("takes a size and asks the next question", async () => {
    const f = fake({}, { open: openDraft() });
    const r = await handleTradeMessage(f.store, msg("0.5"), NOW);
    expect(f.saved[0][1].answers.lots).toBe(0.5);
    expect(r?.text).toMatch(/When was it\?/);
  });

  it("repeats the question with a hint when the answer does not parse", async () => {
    const f = fake({}, { open: openDraft() });
    const r = await handleTradeMessage(f.store, msg("half a lot"), NOW);
    expect(r?.text).toMatch(/A number of lots/);
    expect(r?.text).toMatch(/Size in lots\?/);
  });

  it("reaches the picker once everything is answered", async () => {
    const f = fake({}, {
      open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), date_label: "today", emotion: "calm", tags: [] } }),
    });
    const r = await handleTradeMessage(f.store, msg("held through news"), NOW);
    expect(r?.text).toMatch(/Notes: held through news/);
    expect(r?.text).toMatch(/Which journal\?/);
  });

  it("replaces the draft when a new trade arrives mid-questions", async () => {
    const f = fake({}, { open: openDraft() });
    const r = await handleTradeMessage(f.store, msg("EURUSD sell 1.0850 sl 1.0880 closed 1.0820"), NOW);
    expect(f.cancelled).toEqual(["aB3_x-9Q"]);
    expect(f.held).toHaveLength(1);
    expect(f.held[0].draft.instrument).toBe("EURUSD");
    expect(r?.text).toMatch(/Size in lots\?/);
  });

  it("ignores an answer once the link no longer matches the draft", async () => {
    const f = fake({ linkedUser: async () => "someone-else" }, { open: openDraft() });
    expect(await handleTradeMessage(f.store, msg("0.5"), NOW)).toBeNull();
  });
});

describe("what the reviewers found", () => {
  it("counts greetings and commands against the allowance, and stays quiet over it", async () => {
    const f = fake({ allow: async () => false });
    expect(await handleTradeMessage(f.store, msg("/start", 999), NOW)).toBeNull();
    expect(await handleTradeMessage(f.store, msg("hey", 999), NOW)).toBeNull();
    expect(await handleTradeMessage(f.store, msg("/cancel"), NOW)).toBeNull();
  });

  it("tells a person their draft expired instead of saying nothing", async () => {
    const f = fake({}, { open: openDraft({ answers: {} }, { expiresAt: "2026-09-03T13:00:00Z" }) });
    const r = await handleTradeMessage(f.store, msg("0.5"), NOW);
    expect(r?.text).toMatch(/expired/);
    expect(f.cancelled).toEqual(["aB3_x-9Q"]);
  });

  it("answers, cancels and replaces a draft whose picker is already showing", async () => {
    const ready = openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: null, tags: [], notes: null }, ready: true });
    const chat = fake({}, { open: ready });
    expect((await handleTradeMessage(chat.store, msg("thanks!"), NOW))?.text).toMatch(/Pick a journal/);
    const cancel = fake({}, { open: ready });
    expect((await handleTradeMessage(cancel.store, msg("/cancel"), NOW))?.text).toMatch(/Cancelled/);
    const replace = fake({}, { open: ready });
    await handleTradeMessage(replace.store, msg("EURUSD sell 1.0850 sl 1.0880 closed 1.0820"), NOW);
    expect(replace.cancelled).toEqual(["aB3_x-9Q"]);
    expect(replace.held).toHaveLength(1);
  });

  it("changes an earlier answer by name, at any stage", async () => {
    const f = fake({}, { open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), date_label: "today" } }) });
    const r = await handleTradeMessage(f.store, msg("date 28 aug"), NOW);
    expect(f.saved[0][1].answers.entry_time?.slice(0, 10)).toBe("2026-08-28");
    // The open question (mood) is asked again, not skipped.
    expect(r?.text).toMatch(/How did it feel/);
  });

  it("changes an answer after the picker and shows the new summary", async () => {
    const f = fake({}, {
      quick: true,
      open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), date_label: "today" }, ready: true }),
    });
    const r = await handleTradeMessage(f.store, msg("size 1"), NOW);
    expect(f.saved[0][1].answers.lots).toBe(1);
    expect(r?.text).toMatch(/1 lots/);
    expect(r?.text).toMatch(/Which journal\?/);
  });

  it("treats a result word as a correction to the trade, not as a note", async () => {
    const saves: TradeDraft[] = [];
    const f = fake({ saveDraft: async (_id, d) => { saves.push(d); return true; } }, {
      open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: null, tags: [] } }),
    });
    const r = await handleTradeMessage(f.store, msg("sl"), NOW);
    expect(saves[0]?.outcome).toEqual({ kind: "result", result: "sl" });
    expect(r?.text).toMatch(/stopped out/);
    expect(f.saved.every(([, c]) => c.answers.notes === undefined)).toBe(true);
  });

  it("refuses a correction it cannot work out", async () => {
    const f = fake({}, { open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString() } }) });
    const r = await handleTradeMessage(f.store, msg("tp2 hit"), NOW);
    expect(r?.text).toMatch(/TP2 price is missing/);
  });

  it("reminds about the waiting draft when a half-typed trade arrives", async () => {
    const f = fake({}, { open: openDraft() });
    const r = await handleTradeMessage(f.store, msg("EURUSD buy 1.0850"), NOW);
    expect(r?.text).toMatch(/Not yet/);
    expect(r?.text).toMatch(/earlier XAUUSD trade is still waiting/);
    expect(f.cancelled).toHaveLength(0);
  });

  it("does not take an answer from a different chat than the draft's", async () => {
    const f = fake({}, { open: openDraft({ answers: {} }, { chatId: "other-chat" }) });
    expect(await handleTradeMessage(f.store, msg("0.5"), NOW)).toBeNull();
  });

  it("says so when an answer could not be held", async () => {
    const f = fake({ saveConversation: async () => false }, { open: openDraft() });
    const r = await handleTradeMessage(f.store, msg("0.5"), NOW);
    expect(r?.text).toMatch(/Couldn't hold/);
  });
});

describe("edge cases in real typing", () => {
  it("ignores a sticker or an uncaptioned photo, even mid-conversation", async () => {
    const f = fake({}, { open: openDraft() });
    expect(await handleTradeMessage(f.store, msg(""), NOW)).toBeNull();
    expect(await handleTradeMessage(f.store, msg("   "), NOW)).toBeNull();
    expect(f.saved).toHaveLength(0);
  });

  it("keeps a note whole when it happens to start with the word note", async () => {
    const f = fake({}, {
      open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: null, tags: [] } }),
    });
    await handleTradeMessage(f.store, msg("note to self: don't chase"), NOW);
    expect(f.saved[0][1].answers.notes).toBe("note to self: don't chase");
  });

  it("still takes a named edit of another field at the notes question", async () => {
    const f = fake({}, {
      open: openDraft({ answers: { lots: 0.5, entry_time: NOW.toISOString(), emotion: null, tags: [] } }),
    });
    await handleTradeMessage(f.store, msg("size 1"), NOW);
    expect(f.saved[0][1].answers.lots).toBe(1);
  });

  it("shows the answers already given when the result is corrected", async () => {
    const f = fake({}, {
      open: openDraft({ answers: { lots: 0.5, entry_time: "2026-08-28T12:00:00.000Z", date_label: null } }),
    });
    const r = await handleTradeMessage(f.store, msg("still open"), NOW);
    expect(r?.text).toMatch(/still open/);
    expect(r?.text).toMatch(/0\.5 lots/);
    expect(r?.text).toMatch(/2026-08-28/);
  });
});
