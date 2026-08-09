import { describe, expect, it } from "vitest";
import { computeAutoSize, type AutoSizeInput } from "@/lib/trades/auto-size";

/**
 * Position size derived from the journal's account capital, so the trader
 * never types a quantity. The money at risk must stay fixed at
 * capital × risk% regardless of how wide the stop is — that is the whole point
 * of risk-based sizing, and what makes P&L comparable across trades.
 */

const base: AutoSizeInput = {
  capital: 10_000,
  accountCurrency: "USD",
  riskPercent: 1,
  instrument: "EURUSD",
  direction: "buy",
  entryPrice: 1.1,
  stopLossPrice: 1.095, // 50 pips
};

describe("computeAutoSize", () => {
  it("risks exactly capital × risk% (1% of 10k = $100)", () => {
    const r = computeAutoSize(base)!;
    expect(r.riskAmount).toBeCloseTo(100, 6);
  });

  it("sizes EURUSD so a 50-pip stop loses the risk amount", () => {
    const r = computeAutoSize(base)!;
    expect(r.pipsAtRisk).toBeCloseTo(50, 1);
    // 20,000 units × 0.0050 price move = $100.
    expect(r.quantity).toBeCloseTo(20_000, 0);
    expect(r.lots).toBeCloseTo(0.2, 2);
  });

  it("halves the size when the stop is twice as wide", () => {
    const wide = computeAutoSize({ ...base, stopLossPrice: 1.09 })!; // 100 pips
    const tight = computeAutoSize(base)!; // 50 pips
    expect(wide.quantity).toBeCloseTo(tight.quantity / 2, 0);
    // …and the money at risk is unchanged. That's the invariant.
    expect(wide.riskAmount).toBeCloseTo(tight.riskAmount, 6);
  });

  it("scales linearly with capital and with risk %", () => {
    const doubleCapital = computeAutoSize({ ...base, capital: 20_000 })!;
    const doubleRisk = computeAutoSize({ ...base, riskPercent: 2 })!;
    const single = computeAutoSize(base)!;
    expect(doubleCapital.quantity).toBeCloseTo(single.quantity * 2, 0);
    expect(doubleRisk.quantity).toBeCloseTo(single.quantity * 2, 0);
  });

  it("works for a sell (stop above entry)", () => {
    const r = computeAutoSize({
      ...base,
      direction: "sell",
      entryPrice: 1.1,
      stopLossPrice: 1.105,
    })!;
    expect(r.riskAmount).toBeCloseTo(100, 6);
    expect(r.quantity).toBeGreaterThan(0);
  });

  it("handles a JPY pair (0.01 pip size) without mis-scaling", () => {
    const r = computeAutoSize({
      ...base,
      instrument: "USDJPY",
      entryPrice: 150,
      stopLossPrice: 149.5, // 50 pips
    })!;
    expect(r.pipsAtRisk).toBeCloseTo(50, 1);
    expect(r.riskAmount).toBeCloseTo(100, 6);
    expect(r.quantity).toBeGreaterThan(0);
    expect(Number.isFinite(r.quantity)).toBe(true);
  });

  describe("turns itself off rather than guessing", () => {
    it.each([
      ["no capital configured", { capital: null }],
      ["zero capital", { capital: 0 }],
      ["no stop loss", { stopLossPrice: null }],
      ["zero risk percent", { riskPercent: 0 }],
      ["no entry price", { entryPrice: 0 }],
      // Stop on the winning side is incoherent — never invent a size for it.
      ["stop above entry on a buy", { stopLossPrice: 1.2 }],
    ])("%s → null", (_label, patch) => {
      expect(computeAutoSize({ ...base, ...(patch as Partial<AutoSizeInput>) })).toBeNull();
    });

    it("a sell with the stop below entry is also rejected", () => {
      expect(
        computeAutoSize({ ...base, direction: "sell", stopLossPrice: 1.05 }),
      ).toBeNull();
    });
  });

  it("never returns a non-finite or negative size", () => {
    for (const stop of [1.0999999, 1.05, 1.0]) {
      const r = computeAutoSize({ ...base, stopLossPrice: stop });
      if (r === null) continue;
      expect(Number.isFinite(r.quantity)).toBe(true);
      expect(r.quantity).toBeGreaterThan(0);
    }
  });
});

describe("lot-step rounding (regression)", () => {
  // 0.2 / 0.01 is 19.999999999999996 in IEEE-754, so a bare floor returned
  // 0.19 lots for an exact 0.20 — one step light on every round size.
  it.each([
    [1.095, 0.2], // 50 pips on 10k @ 1% → exactly 0.20 lots
    [1.09, 0.1], // 100 pips → exactly 0.10 lots
  ])("stop %s → %s lots, not one step light", (stopLossPrice, expected) => {
    const r = computeAutoSize({ ...base, stopLossPrice })!;
    expect(r.lots).toBeCloseTo(expected, 3);
  });

  it("still floors a genuine part-step down", () => {
    // ~0.194 lots must not round UP past the risk budget.
    const r = computeAutoSize({ ...base, stopLossPrice: 1.09484 })!;
    expect(r.lots).toBeLessThanOrEqual(0.2);
    expect(r.lots).toBeCloseTo(0.19, 2);
  });
});
