import { describe, expect, it, vi } from "vitest";
import {
  handleTradeTap,
  STALE_CONSUME_SECONDS,
  type PendingTrade,
  type TradeTapStore,
} from "@/lib/telegram/trade-tap";
import type { TradeDraft } from "@/lib/telegram/trade-intent";

/**
 * The one place a Telegram message becomes a row in `trades`. Every refusal
 * is pinned here with the assertion that matters: NOTHING WAS INSERTED.
 * `trades` has RLS with no policies, so this file is the gate.
 */

const NOW = new Date("2026-09-03T14:00:00Z");
const U = "11111111-2222-4333-8444-555555555555";
const J1 = "aaaaaaaa-0000-4000-8000-000000000001";
const J2 = "aaaaaaaa-0000-4000-8000-000000000002";

const draft = (o: Partial<TradeDraft> = {}): TradeDraft => ({
  instrument: "XAUUSD",
  asset_type: "metal",
  direction: "buy",
  entry_price: 3340,
  entry_price_high: null,
  stop_loss: 3335,
  tp1: 3350, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
  tp4_trailing: false,
  outcome: { kind: "closed_at", exit_price: 3348 },
  entry_time: "2026-09-03T12:00:00.000Z",
  dated_from_text: false,
  date_label: null,
  quantity: null,
  message: "XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348",
  ...o,
});

const pending = (o: Partial<PendingTrade> = {}): PendingTrade => ({
  id: "aB3_x-9Q",
  telegramUserId: 111,
  userId: U,
  chatId: "c1",
  draft: draft(),
  journalIds: [J1, J2],
  expiresAt: "2026-09-03T14:30:00.000Z",
  consumedAt: null,
  tradeId: null,
  ...o,
});

interface Fake {
  store: TradeTapStore;
  inserts: Record<string, unknown>[];
  saved: [string, string][];
}

function fake(p: PendingTrade | null, o: Partial<TradeTapStore> = {}): Fake {
  const inserts: Record<string, unknown>[] = [];
  const saved: [string, string][] = [];
  let consumed = p?.consumedAt !== null && p?.consumedAt !== undefined;
  const store: TradeTapStore = {
    loadPending: async () => p,
    linkedUser: async (id) => (id === 111 ? U : null),
    membership: async (journalId) =>
      journalId === J1 ? { name: "TTC GOLD <SCALP>", canEdit: true, archived: false } : null,
    consume: async () => {
      if (consumed) return false;
      consumed = true;
      return true;
    },
    retake: async () => false,
    lastQuantity: async () => 2.5,
    insertTrade: async (row) => {
      inserts.push(row);
      return { id: "t1" };
    },
    savedTradeFor: async () => null,
    markSaved: async (id, tradeId) => {
      saved.push([id, tradeId]);
    },
    ...o,
  };
  return { store, inserts, saved };
}

const tap = (journalIndex: number | null = 0, o: Partial<{ tapperId: number; chatId: string }> = {}) => ({
  choice: { pendingId: "aB3_x-9Q", journalIndex },
  tapperId: 111,
  chatId: "c1",
  ...o,
});

describe("refusals, each with nothing written", () => {
  it.each<[string, () => Fake, ReturnType<typeof tap>, RegExp]>([
    ["a draft that never existed", () => fake(null), tap(), /expired/],
    ["an expired draft", () => fake(pending({ expiresAt: "2026-09-03T13:59:00Z" })), tap(), /expired/],
    ["a tap by somebody else", () => fake(pending()), tap(0, { tapperId: 222 }), /isn't your trade/],
    ["a forwarded picker", () => fake(pending()), tap(0, { chatId: "partner-group" }), /own chat/],
    [
      "a revoked link",
      () => fake(pending(), { linkedUser: async () => null }),
      tap(),
      /no longer linked/,
    ],
    [
      "a link that now points at another account",
      () => fake(pending(), { linkedUser: async () => "someone-else" }),
      tap(),
      /no longer linked/,
    ],
    ["an index past the list", () => fake(pending()), tap(7), /isn't valid/],
    [
      "membership revoked since the picker was shown",
      () => fake(pending(), { membership: async () => null }),
      tap(),
      /can't write/,
    ],
    [
      "a viewer role",
      () =>
        fake(pending(), {
          membership: async () => ({ name: "J", canEdit: false, archived: false }),
        }),
      tap(),
      /can't write/,
    ],
    [
      "an archived journal",
      () =>
        fake(pending(), {
          membership: async () => ({ name: "J", canEdit: true, archived: true }),
        }),
      tap(),
      /can't write/,
    ],
  ])("refuses %s", async (_name, make, t, answer) => {
    const f = make();
    const r = await handleTradeTap(f.store, t, NOW);
    expect(r.answer).toMatch(answer);
    expect(r.alert).toBe(true);
    expect(f.inserts).toHaveLength(0);
  });

  it("refuses the second of a double-tap without a second insert", async () => {
    const f = fake(pending({ consumedAt: "2026-09-03T13:59:59Z", tradeId: "t9" }));
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.answer).toBe("Already saved.");
    expect(f.inserts).toHaveLength(0);
  });

  it("waits when another tap is still saving", async () => {
    const f = fake(pending({ consumedAt: "2026-09-03T13:59:50Z" }));
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.answer).toMatch(/already/i);
    expect(f.inserts).toHaveLength(0);
  });
});

describe("saving", () => {
  it("writes the row with ownership from the store, not the tap", async () => {
    const f = fake(pending());
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.answer).toBe("Saved.");
    expect(r.clearPicker).toBe(true);
    expect(f.inserts).toHaveLength(1);
    const row = f.inserts[0];
    expect(row.user_id).toBe(U);
    expect(row.journal_id).toBe(J1);
    expect(row.source).toBe("manual");
    expect(row.telegram_pending_id).toBe("aB3_x-9Q");
    expect(row.exit_price).toBe(3348);
    expect(String(row.notes)).toContain("XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348");
    expect(f.saved).toEqual([["aB3_x-9Q", "t1"]]);
  });

  it("sizes from history when the message did not, and says so", async () => {
    const f = fake(pending());
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(f.inserts[0].quantity).toBe(2.5);
    expect(r.message).toContain("(size 2.5, as last time)");
  });

  it("uses the typed size without comment", async () => {
    const f = fake(pending({ draft: draft({ quantity: 0.5 }) }));
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(f.inserts[0].quantity).toBe(0.5);
    expect(r.message).not.toContain("as last time");
  });

  it("falls back to 1 when there is no history", async () => {
    const f = fake(pending(), { lastQuantity: async () => null });
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(f.inserts[0].quantity).toBe(1);
    expect(r.message).not.toContain("as last time");
  });

  it("escapes the journal name in the confirmation", async () => {
    const f = fake(pending());
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.message).toContain("TTC GOLD &lt;SCALP&gt;");
  });

  it("re-takes a draft whose earlier tap died between consume and insert", async () => {
    const stale = new Date(NOW.getTime() - (STALE_CONSUME_SECONDS + 5) * 1000).toISOString();
    const retake = vi.fn(async () => true);
    const f = fake(pending({ consumedAt: stale }), { retake });
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(retake).toHaveBeenCalledOnce();
    expect(r.answer).toBe("Saved.");
    expect(f.inserts).toHaveLength(1);
  });

  it("treats a duplicate-key refusal as already saved, and records which trade", async () => {
    const f = fake(pending(), {
      insertTrade: async () => ({ duplicate: true }),
      savedTradeFor: async () => "t7",
    });
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.answer).toBe("Saved.");
    expect(f.saved).toEqual([["aB3_x-9Q", "t7"]]);
  });

  it("leaves the draft consumed on an insert error, so a retry cannot double-save", async () => {
    const f = fake(pending(), { insertTrade: async () => ({ error: "boom" }) });
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(r.message).toMatch(/Nothing was written/);
    expect(r.clearPicker).toBe(false);
    expect(f.saved).toHaveLength(0);
  });

  it("explains a draft the validator refuses, in the chat, and retires the picker", async () => {
    // A stop above the entry on a buy. The intent parser refuses this before
    // a picker exists; the schema is the second line.
    const f = fake(pending({ draft: draft({ stop_loss: 3345 }) }));
    const r = await handleTradeTap(f.store, tap(), NOW);
    expect(f.inserts).toHaveLength(0);
    expect(r.clearPicker).toBe(true);
    expect(r.message).toMatch(/Couldn't save that:/);
  });

  it("cancels", async () => {
    const f = fake(pending());
    const r = await handleTradeTap(f.store, tap(null), NOW);
    expect(r.answer).toBe("Cancelled.");
    expect(r.clearPicker).toBe(true);
    expect(f.inserts).toHaveLength(0);
  });
});
