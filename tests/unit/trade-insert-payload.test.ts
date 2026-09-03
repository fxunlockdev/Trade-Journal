import { describe, expect, it } from "vitest";
import { tradeInsertPayload } from "@/lib/trades/insert-payload";

/**
 * `journal_id` is NOT NULL, and one of the two hand-written insert paths
 * omitted it. Every trade the AI chat tried to create failed on a null
 * violation for two months, silently, because the error became a chat reply.
 *
 * The type now makes that omission a compile error. These pin the runtime
 * behaviour the type cannot express.
 */

const OWNER = {
  userId: "11111111-2222-4333-8444-555555555555",
  journalId: "99999999-8888-4777-8666-555555555555",
};

describe("tradeInsertPayload", () => {
  it("always carries the journal", () => {
    const p = tradeInsertPayload({ instrument: "XAUUSD" }, OWNER);
    expect(p.journal_id).toBe(OWNER.journalId);
  });

  it("always carries the owner", () => {
    expect(tradeInsertPayload({}, OWNER).user_id).toBe(OWNER.userId);
  });

  it("forces source to manual", () => {
    // Broker provenance is written only by the import and sync paths. A caller
    // that could claim "csv" would disarm the P&L recompute guard on every
    // later edit of that trade.
    const p = tradeInsertPayload({ source: "mt5_webhook" }, OWNER);
    expect(p.source).toBe("manual");
  });

  it("overrides ownership from the computed fields, not the reverse", () => {
    // Applied AFTER the computation so a stray key earlier in a spread chain
    // cannot reach the three fields RLS and the P&L guard read.
    const p = tradeInsertPayload(
      { user_id: "someone-else", journal_id: "another-journal" },
      OWNER,
    );
    expect(p.user_id).toBe(OWNER.userId);
    expect(p.journal_id).toBe(OWNER.journalId);
  });

  it("keeps every other computed field untouched", () => {
    const p = tradeInsertPayload(
      { instrument: "EURUSD", entry_price: 1.1, pnl_absolute: 42 },
      OWNER,
    );
    expect(p.instrument).toBe("EURUSD");
    expect(p.entry_price).toBe(1.1);
    expect(p.pnl_absolute).toBe(42);
  });
});
