import { describe, expect, it } from "vitest";
import { computeTradePips, computeTotalPips } from "@/lib/trades/pips";
import type { Trade } from "@/types/database";

/** Minimal Trade — computeTradePips only reads these fields. */
const mk = (o: Partial<Trade>): Trade =>
  ({
    instrument: "EURUSD",
    direction: "buy",
    entry_price: 1.1,
    exit_price: null,
    tp1: null,
    tp2: null,
    tp3: null,
    tp4: null,
    tp5: null,
    tp6: null,
    tp7: null,
    tp1_result: null,
    tp2_result: null,
    tp3_result: null,
    tp4_result: null,
    tp5_result: null,
    tp6_result: null,
    tp7_result: null,
    ...o,
  }) as Trade;

describe("computeTradePips", () => {
  it("buy: profit is positive", () => {
    expect(computeTradePips(mk({ direction: "buy", entry_price: 1.1, exit_price: 1.105 }))).toBeCloseTo(50, 5);
  });

  it("sell: a favourable (downward) move is positive", () => {
    expect(computeTradePips(mk({ direction: "sell", entry_price: 1.105, exit_price: 1.1 }))).toBeCloseTo(50, 5);
  });

  it("sell: an adverse (upward) move is negative", () => {
    expect(computeTradePips(mk({ direction: "sell", entry_price: 1.1, exit_price: 1.105 }))).toBeCloseTo(-50, 5);
  });

  it("scales by the instrument pip size (JPY = 0.01)", () => {
    expect(computeTradePips(mk({ instrument: "USDJPY", direction: "buy", entry_price: 150, exit_price: 150.5 }))).toBeCloseTo(50, 5);
  });

  it("a hit TP measures to the REALIZED exit, not the TP target", () => {
    const t = mk({
      direction: "buy",
      entry_price: 1.1,
      tp1: 1.106,
      tp1_result: "hit",
      exit_price: 1.1055, // real fill — pips measure here, not to tp1
    });
    expect(computeTradePips(t)).toBeCloseTo(55, 5);
  });

  it("falls back to the highest hit TP only when there is no exit", () => {
    const t = mk({ direction: "buy", entry_price: 1.1, tp1: 1.106, tp1_result: "hit", exit_price: null });
    expect(computeTradePips(t)).toBeCloseTo(60, 5);
  });

  it("a net-losing partial reports NEGATIVE pips (agrees with P&L, not the hit TP)", () => {
    // TP1 hit but later slices stopped out → weighted realized exit is BELOW
    // entry. Measuring to tp1 would wrongly show +10; realized must be negative.
    const t = mk({
      direction: "buy",
      entry_price: 1.1,
      tp1: 1.101,
      tp1_result: "hit",
      tp2_result: "sl",
      tp3_result: "sl",
      exit_price: 1.0987, // weighted realized close — a loss
    });
    const pips = computeTradePips(t)!;
    expect(pips).toBeLessThan(0);
    expect(pips).toBeCloseTo(-13, 5);
  });

  it("an SL/manual close measures to the actual exit", () => {
    const t = mk({ direction: "buy", entry_price: 1.1, tp1: 1.106, tp1_result: "sl", exit_price: 1.097 });
    expect(computeTradePips(t)).toBeCloseTo(-30, 5);
  });

  it("returns null for an open trade (no exit, no hit)", () => {
    expect(computeTradePips(mk({ exit_price: null }))).toBeNull();
  });
});

describe("computeTotalPips", () => {
  it("sums closed trades and ignores open ones", () => {
    const trades = [
      mk({ direction: "buy", entry_price: 1.1, exit_price: 1.105 }), // +50
      mk({ direction: "sell", entry_price: 1.1, exit_price: 1.105 }), // -50
      mk({ direction: "buy", entry_price: 1.1, exit_price: 1.102 }), // +20
      mk({ exit_price: null }), // open → skipped
    ];
    expect(computeTotalPips(trades)).toBeCloseTo(20, 5);
  });

  it("is empty-set safe", () => {
    expect(computeTotalPips([])).toBe(0);
  });
});
