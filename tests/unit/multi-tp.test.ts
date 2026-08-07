import { describe, expect, it } from "vitest";
import {
  computeMultiTpPnl,
  computeTradeFields,
  resolveDisplayExitPrice,
} from "@/lib/trades/computations";
import { computeTradePips, computeDisplayRR } from "@/lib/trades/pips";
import type { Trade } from "@/types/database";

/**
 * Multi-target trades: a SINGLE position that runs through several TP levels
 * closes at the FURTHEST level reached. The old slice logic collapsed to
 * `concrete[0]` when num_positions === 1, so only TP1 ever counted — exit
 * price, pips and P&L were all pinned to TP1.
 */

const mk = (o: Partial<Trade>): Trade =>
  ({
    instrument: "EURUSD",
    direction: "buy",
    entry_price: 1.1,
    exit_price: null,
    quantity: 100_000,
    fees: 0,
    stop_loss: null,
    take_profit: null,
    tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
    tp1_result: null, tp2_result: null, tp3_result: null,
    tp4_result: null, tp5_result: null, tp6_result: null, tp7_result: null,
    num_positions: 1,
    split_risk: false,
    ...o,
  }) as Trade;

describe("reported bug — USDJPY sell, TP2 hit of 3, Single mode", () => {
  // entry 163.86, SL 163.96 (10 pips risk), TP1/2/3 at 10/20/30 pips.
  // TPs 1 and 2 hit → the position closed at TP2.
  const trade = mk({
    instrument: "USDJPY",
    direction: "sell",
    entry_price: 163.86,
    stop_loss: 163.96,
    tp1: 163.76,
    tp2: 163.66,
    tp3: 163.56,
    tp1_result: "hit",
    tp2_result: "hit",
    exit_price: 163.76, // stored by the OLD buggy save (pinned to TP1)
  });

  it("exits at TP2, not TP1", () => {
    expect(computeMultiTpPnl(trade)!.price).toBeCloseTo(163.66, 5);
    expect(resolveDisplayExitPrice(trade)).toBeCloseTo(163.66, 5);
  });

  it("counts 20 pips (was 10)", () => {
    expect(computeTradePips(trade)).toBeCloseTo(20, 5);
  });

  it("keeps R:R at 1:2 (measured to the furthest hit TP)", () => {
    expect(computeDisplayRR(trade)).toBeCloseTo(2, 5);
  });

  it("P&L reflects the full TP2 move", () => {
    // 20 pips × 0.01 × 100_000 units = 2000 quote units.
    expect(computeMultiTpPnl(trade)!.value).toBeCloseTo(0.2 * 100_000, 2);
  });
});

describe("reported bug — EURUSD buy, 3/3 hit, Single mode", () => {
  // entry 1.13680, SL 1.13580 (10 pips risk), TPs at 10/20/30 pips, all hit.
  const trade = mk({
    direction: "buy",
    entry_price: 1.1368,
    stop_loss: 1.1358,
    tp1: 1.1378,
    tp2: 1.1388,
    tp3: 1.1398,
    tp1_result: "hit",
    tp2_result: "hit",
    tp3_result: "hit",
    exit_price: 1.1378, // stored by the OLD buggy save
  });

  it("exits at TP3", () => {
    expect(resolveDisplayExitPrice(trade)).toBeCloseTo(1.1398, 6);
  });

  it("counts 30 pips (was 10)", () => {
    expect(computeTradePips(trade)).toBeCloseTo(30, 4);
  });

  it("shows R:R 1:3 for correctly-entered TP prices", () => {
    expect(computeDisplayRR(trade)).toBeCloseTo(3, 4);
  });
});

describe("single position — non-hit outcomes", () => {
  it("stopped out closes at the SL", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "sl",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.095, 5);
    expect(computeTradePips(t)).toBeCloseTo(-50, 4);
  });

  it("break-even closes at entry", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "be",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.1, 5);
    expect(computeTradePips(t)).toBeCloseTo(0, 4);
  });

  it("a hit still wins over a later sl marker (the level WAS reached)", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "hit", tp2_result: "sl",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.105, 5);
  });
});

describe("split positions — weighted close is unchanged", () => {
  // The audit case: TP1 hit, later slices stopped out → a NET LOSS must not
  // report positive pips.
  const split = mk({
    entry_price: 2000,
    instrument: "XAUUSD",
    stop_loss: 1980,
    tp1: 2001, tp2: 2010, tp3: 2020,
    tp1_result: "hit", tp2_result: "sl", tp3_result: "sl",
    num_positions: 3,
    split_risk: true,
    quantity: 300,
  });

  it("averages the slices instead of taking the furthest hit", () => {
    const price = computeMultiTpPnl(split)!.price;
    expect(price).toBeCloseTo((2001 + 1980 + 1980) / 3, 5);
    expect(price).toBeLessThan(2000); // below entry → a loss
  });

  it("reports negative pips, agreeing with the loss", () => {
    expect(computeTradePips(split)!).toBeLessThan(0);
  });

  it("a fully-won split still averages its targets", () => {
    const won = mk({
      entry_price: 2000, instrument: "XAUUSD", stop_loss: 1990,
      tp1: 2010, tp2: 2020,
      tp1_result: "hit", tp2_result: "hit",
      num_positions: 2, split_risk: true, quantity: 200,
    });
    expect(computeMultiTpPnl(won)!.price).toBeCloseTo(2015, 5);
  });
});

describe("no regression for broker-sourced and single-target rows", () => {
  it("a broker row with one TP keeps its real fill, not the TP target", () => {
    // Import stamps tp1_result="hit" and stores the actual fill price.
    const t = mk({
      entry_price: 1.14231, tp1: 1.143, tp1_result: "hit",
      exit_price: 1.14290, // real fill, short of the target
    });
    expect(resolveDisplayExitPrice(t)).toBeCloseTo(1.1429, 6);
    expect(computeTradePips(t)).toBeCloseTo(5.9, 4);
  });

  it("a plain trade with no TP results uses its exit price", () => {
    const t = mk({ entry_price: 1.1, exit_price: 1.105 });
    expect(resolveDisplayExitPrice(t)).toBeCloseTo(1.105, 6);
    expect(computeTradePips(t)).toBeCloseTo(50, 4);
  });

  it("an open trade has no pips", () => {
    expect(computeTradePips(mk({ tp1: 1.105, tp2: 1.11 }))).toBeNull();
  });
});

describe("computeTradeFields agrees with the resolved exit", () => {
  it("saves the TP2 exit and its P&L for a single position", () => {
    const t = mk({
      direction: "sell", instrument: "USDJPY",
      entry_price: 163.86, stop_loss: 163.96,
      tp1: 163.76, tp2: 163.66,
      tp1_result: "hit", tp2_result: "hit",
      quantity: 100_000,
    });
    const computed = computeTradeFields(t);
    expect(computed.exit_price).toBeCloseTo(163.66, 5);
    expect(computed.pnl_absolute).toBeCloseTo(0.2 * 100_000, 2);
    expect(computed.r_multiple).toBeCloseTo(2, 4); // 20 pips gained / 10 risked
  });
});
