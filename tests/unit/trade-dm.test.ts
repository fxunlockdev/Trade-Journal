import { describe, expect, it, vi } from "vitest";
import {
  handleTradeMessage,
  PENDING_TTL_MINUTES,
  type DraftToHold,
  type TradeDmStore,
} from "@/lib/telegram/trade-dm";
import { decodeTrade } from "@/lib/telegram/commands";

const NOW = new Date("2026-09-03T14:00:00Z");
const U = "11111111-2222-4333-8444-555555555555";

function fake(o: Partial<TradeDmStore> = {}) {
  const held: DraftToHold[] = [];
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
    ...o,
  };
  return { store, held, allow };
}

const msg = (text: string, telegramUserId = 111) => ({ text, telegramUserId, chatId: "c1" });

describe("first contact", () => {
  it("answers /start with how to link, when not linked", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("/start", 999), NOW);
    expect(r?.text).toMatch(/Settings → Telegram/);
    expect(r?.text).toMatch(/XAUUSD buy 3340/);
  });

  it("answers /help without the linking step, when linked", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("/help"), NOW);
    expect(r?.text).not.toMatch(/First, link/);
    expect(r?.text).toMatch(/still open/);
  });

  it("tells a DM'd report command where reports go", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("/daily"), NOW);
    expect(r?.text).toMatch(/connected group/);
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
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 closed 3348"), NOW);
    expect(r).toBeNull();
    expect(f.held).toHaveLength(0);
  });
});

describe("a trade", () => {
  it("asks an unlinked sender to link, without holding anything", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 closed 3348", 999), NOW);
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
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 closed 3348"), NOW);
    expect(r?.text).toMatch(/nowhere to put/);
    expect(f.held).toHaveLength(0);
  });

  it("holds the draft with the journals offered and asks which", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 closed 3348"), NOW);
    expect(f.held).toHaveLength(1);
    const d = f.held[0];
    expect(d.id).toBe("aB3_x-9Q");
    expect(d.userId).toBe(U);
    expect(d.telegramUserId).toBe(111);
    expect(d.chatId).toBe("c1");
    expect(d.journalIds).toEqual(["j1", "j2"]);
    expect(d.expiresAt).toBe(new Date(NOW.getTime() + PENDING_TTL_MINUTES * 60_000).toISOString());
    expect(d.draft.message).toBe("XAUUSD buy 3340 sl 3335 closed 3348");

    expect(r?.text).toMatch(/Which journal\?/);
    expect(r?.text).toMatch(/\+80[.,]0 pips/);
    const buttons = r?.buttons ?? [];
    expect(buttons.map((b) => b.text)).toEqual(["TTC GOLD | SCALP", "TTC FOREX", "Cancel"]);
    expect(decodeTrade(buttons[0].callback_data)).toEqual({ pendingId: "aB3_x-9Q", journalIndex: 0 });
    expect(decodeTrade(buttons[2].callback_data)).toEqual({ pendingId: "aB3_x-9Q", journalIndex: null });
  });

  it("flags an open trade as not countable", async () => {
    const f = fake();
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 tp1 3350 still open"), NOW);
    expect(r?.text).toMatch(/won't appear on a poster/);
  });

  it("says so when the draft could not be held", async () => {
    const f = fake({ holdDraft: async () => false });
    const r = await handleTradeMessage(f.store, msg("XAUUSD buy 3340 sl 3335 closed 3348"), NOW);
    expect(r?.text).toMatch(/Couldn't hold/);
    expect(r?.buttons).toBeUndefined();
  });
});
