import { describe, expect, it } from "vitest";
import { computeMultiTpPnl, computeTradeFields } from "@/lib/trades/computations";
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

/**
 * A row as the DB would hold it after a save: exit_price and P&L written by
 * computeTradeFields. Pips are read off the stored exit, so any assertion about
 * displayed pips must run against a saved row, never a bare fixture.
 */
const saved = (t: Trade): Trade => {
  const c = computeTradeFields(t);
  return { ...t, exit_price: c.exit_price, pnl_absolute: c.pnl_absolute } as Trade;
};

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
    // The saved row carries that exit, so pips follow it.
    expect(computeTradeFields(trade).exit_price).toBeCloseTo(163.66, 5);
  });

  it("counts 20 pips (was 10) once the row is saved with the fixed exit", () => {
    expect(computeTradePips(saved(trade))).toBeCloseTo(20, 5);
  });

  it("pips and stored P&L tell the same story (no display/data divergence)", () => {
    const row = saved(trade);
    const pips = computeTradePips(row)!;
    expect(pips).toBeCloseTo(20, 5);
    // The yen gain converted to USD at the exit rate — pips and money agree in
    // sign and magnitude, just denominated in the account currency.
    const yenGain = pips * 0.01 * row.quantity;
    expect(row.pnl_absolute!).toBeCloseTo(yenGain / row.exit_price!, 4);
    expect(row.pnl_absolute!).toBeGreaterThan(0);
  });

  it("keeps R:R at 1:2 (measured to the furthest hit TP)", () => {
    expect(computeDisplayRR(trade)).toBeCloseTo(2, 5);
  });

  it("P&L reflects the full TP2 move, valued in the account currency", () => {
    // 20 pips × 0.01 × 100,000 units = 20,000 JPY, converted at the TP2 exit.
    expect(computeMultiTpPnl(trade)!.value).toBeCloseTo((0.2 * 100_000) / 163.66, 2);
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
    expect(computeTradeFields(trade).exit_price).toBeCloseTo(1.1398, 6);
  });

  it("counts 30 pips (was 10) once the row is saved with the fixed exit", () => {
    expect(computeTradePips(saved(trade))).toBeCloseTo(30, 4);
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
    expect(computeTradePips(saved(t))).toBeCloseTo(-50, 4);
  });

  it("break-even closes at entry", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "be",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.1, 5);
    expect(computeTradePips(t)).toBeCloseTo(0, 4);
  });

  it("a break-even on a LATER target does not wipe out the banked hits", () => {
    // Reported bug: marking BE collapsed the whole trade to entry → P&L 0,
    // erasing TP1/TP2 that had already been reached.
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095, quantity: 100_000,
      tp1: 1.105, tp2: 1.11, tp3: 1.115,
      tp1_result: "hit", tp2_result: "hit", tp3_result: "be",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.11, 5); // TP2, not entry
    expect(computeMultiTpPnl(t)!.value).toBeCloseTo(0.01 * 100_000, 2);
    expect(computeTradePips(saved(t))).toBeCloseTo(100, 4);
  });

  it.each([2, 3, 4])(
    "BE marked on TP%i behaves the same — the furthest hit still counts",
    (beSlot) => {
      const base: Partial<Trade> = {
        entry_price: 1.1, stop_loss: 1.095, quantity: 100_000,
        tp1: 1.105, tp2: 1.11, tp3: 1.115, tp4: 1.12,
        tp1_result: "hit",
      };
      // Everything below the BE slot is hit; the BE sits on top.
      const marks: Partial<Trade> = {};
      for (let i = 2; i < beSlot; i += 1) {
        (marks as Record<string, unknown>)[`tp${i}_result`] = "hit";
      }
      (marks as Record<string, unknown>)[`tp${beSlot}_result`] = "be";
      const t = mk({ ...base, ...marks });
      const furthestHit = [1.105, 1.11, 1.115][beSlot - 2];
      expect(computeMultiTpPnl(t)!.price).toBeCloseTo(furthestHit, 5);
      expect(computeMultiTpPnl(t)!.value).toBeGreaterThan(0);
    },
  );

  it("a stop-out on a later target also leaves the banked hits intact", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "hit", tp2_result: "sl",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.105, 5);
    expect(computeMultiTpPnl(t)!.value).toBeGreaterThan(0);
  });

  it("break-even with NO hit at all still closes at entry (P&L 0)", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.095,
      tp1: 1.105, tp2: 1.11, tp1_result: "be",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.1, 5);
    expect(computeMultiTpPnl(t)!.value).toBeCloseTo(0, 6);
  });

  it("falls through to break-even when an sl has no stop price", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: null,
      tp1: 1.105, tp2: 1.11, tp1_result: "sl", tp2_result: "be",
    });
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(1.1, 5);
  });

  it("R:R and the exit price resolve to the SAME target", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.09,
      tp1: 1.105, tp2: 1.12, tp3: 1.13,
      tp1_result: "hit", tp2_result: "hit", tp3_result: "be",
    });
    const computed = computeTradeFields(t);
    expect(computed.exit_price).toBeCloseTo(1.12, 5);
    // reward 0.02 / risk 0.01 = 2 — measured to the same TP2 the exit used.
    expect(computed.risk_reward_ratio).toBeCloseTo(2, 4);
    expect(computeDisplayRR(t)).toBeCloseTo(2, 4);
  });

  it("an sl outcome with no stop price is unresolvable (null, not a guess)", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: null,
      tp1: 1.105, tp2: 1.11, tp1_result: "sl",
    });
    expect(computeMultiTpPnl(t)).toBeNull();
  });

  it("hit results with no TP prices are unresolvable", () => {
    expect(computeMultiTpPnl(mk({ tp1_result: "hit", tp2_result: "hit" }))).toBeNull();
  });

  it("a trailing target with an outcome but NO price falls back to the last priced level", () => {
    // The form's "Open / Trail" checkbox disables TP4's price input while its
    // Outcome buttons stay live. Aborting on that slot used to save the trade
    // with a null exit and null P&L — it vanished from every money metric while
    // the table still rendered it as a win.
    const t = mk({
      entry_price: 1.1, stop_loss: 1.09, quantity: 100_000,
      tp1: 1.11, tp2: 1.12, tp3: 1.13,
      tp1_result: "hit", tp2_result: "hit", tp3_result: "hit",
      tp4: null, tp4_result: "hit", tp4_trailing: true,
    });
    const outcome = computeMultiTpPnl(t);
    expect(outcome).not.toBeNull();
    expect(outcome!.price).toBeCloseTo(1.13, 5); // last PRICED level

    const row = saved(t);
    expect(row.exit_price).toBeCloseTo(1.13, 5);
    expect(row.pnl_absolute).not.toBeNull();
    // Pips and money agree — the trade counts everywhere or nowhere.
    expect(computeTradePips(row)).toBeCloseTo(300, 4);
    expect(row.pnl_absolute!).toBeCloseTo(0.03 * 100_000, 2);
  });

  it("a NaN TP price is skipped, never propagated into P&L", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.09,
      tp1: 1.105, tp2: Number.NaN, tp1_result: "hit", tp2_result: "hit",
    });
    // The unusable slot is skipped and the last priced level closes the trade —
    // no NaN reaches pnl_absolute, and the trade still counts.
    const outcome = computeMultiTpPnl(t)!;
    expect(outcome.price).toBeCloseTo(1.105, 5);
    expect(Number.isFinite(outcome.value)).toBe(true);
  });

  it("fees reduce the single-position P&L", () => {
    const t = mk({
      entry_price: 1.1, stop_loss: 1.09,
      tp1: 1.105, tp2: 1.11, tp1_result: "hit", tp2_result: "hit",
      fees: 7, quantity: 100_000,
    });
    expect(computeMultiTpPnl(t)!.value).toBeCloseTo(1000 - 7, 2);
  });
});

describe("split predicate — the (split_risk, num_positions) truth table", () => {
  const base = {
    instrument: "XAUUSD", entry_price: 2000, stop_loss: 1980, quantity: 300,
    tp1: 2001, tp2: 2010, tp3: 2020,
    tp1_result: "hit" as const, tp2_result: "sl" as const, tp3_result: "sl" as const,
  };

  it.each([
    // Only split_risk AND >1 position slices the trade. Everything else is ONE
    // position, which keeps the level it banked (TP1 at 2001) — the later
    // stop markers apply to a runner that doesn't exist in single mode.
    [false, 1, 2001],
    [false, 3, 2001],
    [true, 1, 2001],
    // Split: each slice closes at its own outcome, so the stops drag the
    // weighted exit below entry — a genuine net loss.
    [true, 3, (2001 + 1980 + 1980) / 3],
  ])("split_risk=%s num_positions=%s → exit %s", (split_risk, num_positions, expected) => {
    const t = mk({ ...base, split_risk, num_positions } as Partial<Trade>);
    expect(computeMultiTpPnl(t)!.price).toBeCloseTo(expected as number, 5);
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
    const row = saved(split);
    expect(computeTradePips(row)!).toBeLessThan(0);
    // Pips and the stored money must never disagree in sign.
    expect(row.pnl_absolute!).toBeLessThan(0);
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
  it("a broker row keeps its real fill, not the TP target", () => {
    // Import stamps tp1_result="hit" and stores the actual fill price. Pips
    // must measure the fill (5.9), never the target (6.9).
    const t = mk({
      entry_price: 1.14231, tp1: 1.143, tp1_result: "hit",
      exit_price: 1.1429, // real fill, short of the target
    });
    expect(computeTradePips(t)).toBeCloseTo(5.9, 4);
  });

  it("a broker row with an extra user-added TP STILL keeps the real fill", () => {
    const t = mk({
      entry_price: 1.14231, tp1: 1.143, tp2: 1.144, tp1_result: "hit",
      exit_price: 1.1429,
    });
    expect(computeTradePips(t)).toBeCloseTo(5.9, 4);
  });

  it("a manual close between targets keeps the typed exit", () => {
    const t = mk({
      entry_price: 1.1368, tp1: 1.1378, tp2: 1.1388, tp1_result: "hit",
      exit_price: 1.1372, // user closed early by hand
    });
    expect(computeTradePips(t)).toBeCloseTo(4, 4);
  });

  it("a plain trade with no TP results uses its exit price", () => {
    const t = mk({ entry_price: 1.1, exit_price: 1.105 });
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
    // 20,000 JPY converted at the exit rate — not reported as 20,000 dollars.
    expect(computed.pnl_absolute).toBeCloseTo((0.2 * 100_000) / 163.66, 2);
    expect(computed.r_multiple).toBeCloseTo(2, 4); // 20 pips gained / 10 risked
  });
});
