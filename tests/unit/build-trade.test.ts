import { describe, expect, it } from "vitest";
import { buildTradeRow } from "@/lib/trades/build-trade";
import { parseTradeIntent } from "@/lib/telegram/trade-intent";
import { outcomeFields } from "@/lib/trades/outcome-parser";

/**
 * One pipeline for the form, the chat and the bot. The tests here are the
 * ones that would have caught the two-month silent failure in the chat route
 * and the drift between its copy of the normalisation and the form's.
 */

const OWNER = {
  userId: "11111111-2222-4333-8444-555555555555",
  journalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};

const base = {
  instrument: "XAUUSD",
  asset_type: "metal",
  direction: "buy",
  entry_price: 3340,
  quantity: 1,
  entry_time: "2026-09-03T14:00:00.000Z",
};

describe("buildTradeRow", () => {
  it("stamps ownership and provenance from the session, never from the input", () => {
    const r = buildTradeRow(
      { ...base, user_id: "attacker", journal_id: "someone-elses", source: "mt5_webhook" },
      OWNER,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.user_id).toBe(OWNER.userId);
    expect(r.row.journal_id).toBe(OWNER.journalId);
    expect(r.row.source).toBe("manual");
  });

  it("makes every nullable column explicit, so the row and the computation agree", () => {
    const r = buildTradeRow(base, OWNER);
    if (!r.ok) throw new Error(r.issues.join("; "));
    expect(r.row.exit_price).toBeNull();
    expect(r.row.stop_loss).toBeNull();
    expect(r.row.tp7_result).toBeNull();
    expect(r.row.order_type).toBe("market");
    expect(r.row.num_positions).toBe(1);
    expect(r.row.take_profit).toBeNull();
  });

  it("keeps the legacy take_profit in step with tp1", () => {
    const r = buildTradeRow({ ...base, tp1: 3350 }, OWNER);
    if (!r.ok) throw new Error(r.issues.join("; "));
    expect(r.row.take_profit).toBe(3350);
  });

  it("names the field when the input is wrong", () => {
    const r = buildTradeRow({ ...base, entry_price: -1 }, OWNER);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.join(" ")).toMatch(/entry_price/);
    expect(Object.keys(r.fieldErrors)).toContain("entry_price");
  });
});

describe("the chain the bot runs, end to end", () => {
  // parseTradeIntent -> outcomeFields -> buildTradeRow -> computeTradeFields.
  // The exit the reports will publish for each outcome kind, pinned.
  const NOW = new Date("2026-09-03T14:00:00Z");

  it.each([
    ["XAUUSD buy 3340 sl 3335 tp7 3400 tp7 hit", 3400],
    ["XAUUSD buy 3340 sl 3335 stopped out", 3335],
    ["XAUUSD buy 3340 closed 3348", 3348],
    ["XAUUSD buy 3340 sl 3335 be", 3340],
  ])("derives the exit for %j", (text, exit) => {
    const r = parseTradeIntent(text, NOW);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    const d = r.draft;
    const built = buildTradeRow(
      {
        instrument: d.instrument,
        asset_type: d.asset_type,
        direction: d.direction,
        entry_price: d.entry_price,
        quantity: 1,
        entry_time: d.entry_time,
        stop_loss: d.stop_loss,
        tp1: d.tp1, tp7: d.tp7,
        ...outcomeFields(d.outcome),
      },
      OWNER,
    );
    if (!built.ok) throw new Error(built.issues.join("; "));
    expect(built.row.exit_price).toBe(exit);
  });

  it("gives a sell its loss, not a win, when stopped out", () => {
    const r = parseTradeIntent("XAUUSD sell 3340 sl 3345 sl hit", NOW);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    const built = buildTradeRow(
      {
        instrument: "XAUUSD", asset_type: "metal", direction: "sell",
        entry_price: 3340, quantity: 1, entry_time: r.draft.entry_time,
        stop_loss: 3345, ...outcomeFields(r.draft.outcome),
      },
      OWNER,
    );
    if (!built.ok) throw new Error(built.issues.join("; "));
    expect(built.row.exit_price).toBe(3345);
    expect(built.row.pnl_absolute).toBeLessThan(0);
  });
});

describe("an open trade", () => {
  it("has no P&L and no P&L currency, rather than NaN and a stamp", () => {
    // The Telegram path once mapped undefined -> null over zod output, which
    // cannot touch a key zod omitted; exit_price stayed undefined and the
    // closed-trade arithmetic ran on it.
    const r = buildTradeRow({ ...base, stop_loss: 3335 }, OWNER);
    if (!r.ok) throw new Error(r.issues.join("; "));
    expect(r.row.exit_price).toBeNull();
    expect(r.row.pnl_absolute).toBeNull();
    expect(r.row.pnl_currency).toBeNull();
    expect(r.row.pnl_rate_quality).toBeNull();
  });
});
