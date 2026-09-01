import { describe, expect, it } from "vitest";
import {
  computePnlAbsolute,
  computeTradeFields,
  resolvePnlDenomination,
} from "@/lib/trades/computations";
import { quoteToUsdFactor } from "@/lib/trading/quote-conversion";

/**
 * P&L must be reported in the ACCOUNT currency.
 *
 * `priceMove × quantity` is denominated in the instrument's QUOTE currency. For
 * EURUSD/GBPUSD/XAUUSD that's already USD; for USDJPY it's YEN. Reporting the
 * yen figure as dollars overstated a 10-pip USDJPY trade as "$10.00" when it was
 * 10 JPY ≈ $0.06 — 164× out, and the reason JPY pairs looked incomparable with
 * the USD-quoted ones.
 */

describe("quoteToUsdFactor", () => {
  it("is exactly 1 for a USD-quoted pair", () => {
    const c = quoteToUsdFactor({ quoteCurrency: "USD", baseCurrency: "EUR", price: 1.1 });
    expect(c.factor).toBe(1);
    expect(c.approximate).toBe(false);
  });

  it("inverts the price for an indirect quote (USD/XXX) — exact, no table", () => {
    const c = quoteToUsdFactor({ quoteCurrency: "JPY", baseCurrency: "USD", price: 163.76 });
    expect(c.factor).toBeCloseTo(1 / 163.76, 10);
    expect(c.approximate).toBe(false);
  });

  it("prefers an explicit rate over everything else", () => {
    const c = quoteToUsdFactor({
      quoteCurrency: "JPY", baseCurrency: "EUR", price: 175, explicitRate: 1 / 158,
    });
    expect(c.factor).toBeCloseTo(1 / 158, 10);
    expect(c.approximate).toBe(false);
  });

  it("falls back to an approximate rate for a cross, and says so", () => {
    const c = quoteToUsdFactor({ quoteCurrency: "JPY", baseCurrency: "EUR", price: 175 });
    expect(c.approximate).toBe(true);
    expect(c.factor).toBeGreaterThan(0);
    expect(c.note).toMatch(/approximate/i);
  });

  it("refuses to invent a rate for an unknown quote currency", () => {
    const c = quoteToUsdFactor({ quoteCurrency: "XYZ", baseCurrency: "ABC", price: 10 });
    expect(c.factor).toBe(1); // unscaled rather than fabricated
    expect(c.approximate).toBe(true);
    expect(c.note).toMatch(/not USD/i);
  });
});

describe("computePnlAbsolute — the reported bug", () => {
  const QTY = 100; // same quantity on every pair, same +10 pip move

  it("EURUSD (USD quote) is unchanged at $0.10", () => {
    expect(computePnlAbsolute(1.1368, 1.1378, QTY, "buy", 0, "EURUSD")).toBeCloseTo(0.1, 6);
  });

  it("GBPUSD matches EURUSD exactly — both quote USD", () => {
    const eur = computePnlAbsolute(1.1368, 1.1378, QTY, "buy", 0, "EURUSD");
    const gbp = computePnlAbsolute(1.27, 1.271, QTY, "buy", 0, "GBPUSD");
    expect(gbp).toBeCloseTo(eur, 6);
  });

  it("USDJPY is $0.06, not $10.00", () => {
    const pnl = computePnlAbsolute(163.86, 163.76, QTY, "sell", 0, "USDJPY");
    expect(pnl).toBeCloseTo(10 / 163.76, 6);
    expect(pnl).toBeLessThan(0.1);
  });

  it("brings JPY into the same ballpark as USD pairs (was 164x out)", () => {
    const eur = computePnlAbsolute(1.1368, 1.1378, 20_000, "buy", 0, "EURUSD");
    const jpy = computePnlAbsolute(163.86, 163.76, 20_000, "sell", 0, "USDJPY");
    const ratio = eur / jpy;
    expect(ratio).toBeGreaterThan(1); // a JPY pip really is worth less per unit
    expect(ratio).toBeLessThan(2); // …but nowhere near 164x
  });

  it("a loss stays a loss after conversion", () => {
    const pnl = computePnlAbsolute(163.86, 163.96, 100, "sell", 0, "USDJPY");
    expect(pnl).toBeLessThan(0);
  });

  it("fees are account-currency and subtracted AFTER conversion", () => {
    const withFee = computePnlAbsolute(163.86, 163.76, 100, "sell", 5, "USDJPY");
    const noFee = computePnlAbsolute(163.86, 163.76, 100, "sell", 0, "USDJPY");
    expect(noFee - withFee).toBeCloseTo(5, 6);
  });

  it("omitting the instrument leaves the figure unscaled (legacy callers)", () => {
    expect(computePnlAbsolute(163.86, 163.76, 100, "sell", 0)).toBeCloseTo(10, 6);
  });
});

describe("computeTradeFields applies the conversion on every P&L path", () => {
  it("single-exit JPY trade", () => {
    const t = computeTradeFields({
      instrument: "USDJPY", direction: "sell", entry_price: 163.86,
      exit_price: 163.76, quantity: 100, fees: 0,
      stop_loss: 163.96, take_profit: null,
    });
    expect(t.pnl_absolute!).toBeCloseTo(10 / 163.76, 6);
  });

  it("multi-TP JPY trade (the screenshot: TP1 hit, TP2/TP3 BE)", () => {
    const t = computeTradeFields({
      instrument: "USDJPY", direction: "sell", entry_price: 163.86,
      exit_price: null, quantity: 100, fees: 0,
      stop_loss: 163.96, take_profit: null,
      tp1: 163.76, tp2: 163.66, tp3: 163.56,
      tp1_result: "hit", tp2_result: "be", tp3_result: "be",
      num_positions: 1, split_risk: false,
    });
    expect(t.exit_price).toBeCloseTo(163.76, 5); // banked TP1
    expect(t.pnl_absolute!).toBeCloseTo(10 / 163.76, 6); // …valued in USD
  });

  it("split JPY trade converts each slice at its own exit rate", () => {
    const t = computeTradeFields({
      instrument: "USDJPY", direction: "sell", entry_price: 163.86,
      exit_price: null, quantity: 300, fees: 0,
      stop_loss: 163.96, take_profit: null,
      tp1: 163.76, tp2: 163.66, tp3: 163.56,
      tp1_result: "hit", tp2_result: "hit", tp3_result: "hit",
      num_positions: 3, split_risk: true,
    });
    // Slices gain 10/20/30 pips on 100 units each = 10+20+30 = 60 JPY, each
    // converted at its own exit. Sanity: well under the unconverted 60.
    expect(t.pnl_absolute!).toBeGreaterThan(0);
    expect(t.pnl_absolute!).toBeLessThan(1);
    expect(t.pnl_absolute!).toBeCloseTo(
      (10 / 163.76) * 100 / 100 + (20 / 163.66) * 100 / 100 + (30 / 163.56) * 100 / 100,
      4,
    );
  });

  it("USD-quoted trades are untouched by the change", () => {
    const t = computeTradeFields({
      instrument: "EURUSD", direction: "buy", entry_price: 1.1368,
      exit_price: 1.1378, quantity: 100, fees: 0,
      stop_loss: 1.1358, take_profit: null,
    });
    expect(t.pnl_absolute!).toBeCloseTo(0.1, 6);
  });

  it("R-multiple and R:R are ratios — unaffected by currency", () => {
    const t = computeTradeFields({
      instrument: "USDJPY", direction: "sell", entry_price: 163.86,
      exit_price: 163.76, quantity: 100, fees: 0,
      stop_loss: 163.96, take_profit: 163.76,
    });
    expect(t.r_multiple!).toBeCloseTo(1, 4); // gained exactly 1x the risk
    expect(t.risk_reward_ratio!).toBeCloseTo(1, 4);
  });
});

describe("every P&L surface passes the instrument (no preview/saved divergence)", () => {
  /**
   * The trade form's Preview panel and the API both call computeTradeFields.
   * If either omits `instrument`, a JPY trade previews its yen profit as
   * dollars while the other saves the converted figure — the same
   * "display disagrees with stored data" class this repo keeps hitting.
   */
  const jpy = {
    instrument: "USDJPY",
    direction: "sell" as const,
    entry_price: 163.86,
    exit_price: 163.76,
    quantity: 100,
    fees: 0,
    stop_loss: 163.96,
    take_profit: null,
  };

  it("preview (with instrument) matches the API result exactly", () => {
    const preview = computeTradeFields(jpy);
    const api = computeTradeFields({ ...jpy });
    expect(preview.pnl_absolute).toBeCloseTo(api.pnl_absolute!, 10);
    expect(preview.pnl_absolute!).toBeCloseTo(10 / 163.76, 6);
  });

  it("dropping the instrument is what caused the divergence — 164x apart", () => {
    const withSymbol = computeTradeFields(jpy).pnl_absolute!;
    const { instrument: _omitted, ...withoutSymbol } = jpy;
    const naive = computeTradeFields(withoutSymbol).pnl_absolute!;
    expect(naive / withSymbol).toBeCloseTo(163.76, 1);
  });
});

describe("resolvePnlDenomination — what a stored figure is, and how well we know", () => {
  it("a USD-quoted pair is exactly dollars", () => {
    const d = resolvePnlDenomination("EURUSD", 1.1);
    expect(d.factor).toBe(1);
    expect(d.currency).toBe("USD");
    expect(d.quality).toBe("exact");
  });

  it("an indirect quote converts exactly from its own price", () => {
    // USDJPY: the price IS the JPY/USD rate, so no table is consulted.
    const d = resolvePnlDenomination("USDJPY", 163.76);
    expect(d.factor).toBeCloseTo(1 / 163.76, 10);
    expect(d.currency).toBe("USD");
    expect(d.quality).toBe("exact");
  });

  it("a cross is flagged APPROXIMATE — it used a hardcoded mid-rate", () => {
    // This is the flag that makes these rows findable and fixable later.
    const d = resolvePnlDenomination("EURJPY", 175);
    expect(d.currency).toBe("USD");
    expect(d.quality).toBe("approximate");
    expect(d.factor).toBeGreaterThan(0);
  });

  it("an unconvertible currency is reported AS ITSELF, not as dollars", () => {
    // quoteToUsdFactor refuses to invent a rate and leaves the figure in the
    // quote currency. Stamping that 'USD' would be exactly the lie this whole
    // change exists to stop — and the conversion is not "approximate", it
    // simply never happened.
    const d = resolvePnlDenomination("ABCXYZ", 10);
    expect(d.factor).toBe(1);
    expect(d.currency).toBe("XYZ");
    expect(d.quality).toBe("exact");
  });

  it("no instrument means we cannot name the currency, so we say so", () => {
    const d = resolvePnlDenomination(null, 1.1);
    expect(d.factor).toBe(1); // legacy callers stay unscaled
    expect(d.currency).toBeNull();
    expect(d.quality).toBe("assumed");
  });
});

describe("computeTradeFields stamps the denomination", () => {
  const base = {
    instrument: "EURUSD",
    direction: "buy" as const,
    entry_price: 1.1,
    exit_price: 1.101,
    quantity: 10_000,
    fees: 0,
    stop_loss: null,
    tp1: null,
    tp1_result: null,
    num_positions: 1,
    split_risk: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compute = (o: Record<string, unknown>) => computeTradeFields(o as any);

  it("a closed USD-quoted trade is stamped USD / exact", () => {
    const out = compute(base);
    expect(out.pnl_currency).toBe("USD");
    expect(out.pnl_rate_quality).toBe("exact");
  });

  it("a closed cross is stamped approximate", () => {
    const out = compute({ ...base, instrument: "EURJPY", entry_price: 175, exit_price: 175.5 });
    expect(out.pnl_currency).toBe("USD");
    expect(out.pnl_rate_quality).toBe("approximate");
  });

  it("an OPEN trade has no denomination — there is no figure to denominate", () => {
    const out = compute({ ...base, exit_price: null });
    expect(out.pnl_absolute).toBeNull();
    expect(out.pnl_currency).toBeNull();
    expect(out.pnl_rate_quality).toBeNull();
  });

  it("a multi-TP close is denominated at its weighted exit", () => {
    const out = compute({
      ...base,
      exit_price: null,
      tp1: 1.105,
      tp1_result: "hit",
    });
    expect(out.pnl_absolute).not.toBeNull();
    expect(out.pnl_currency).toBe("USD");
    expect(out.pnl_rate_quality).toBe("exact");
  });

  it("STAMPING CHANGES NO MONEY — the whole acceptance criterion", () => {
    // Every pnl_absolute must be byte-identical to what it was before the
    // columns existed. The denomination is metadata about the number, never
    // an input to it.
    for (const t of [
      base,
      { ...base, instrument: "USDJPY", entry_price: 150, exit_price: 150.2 },
      { ...base, instrument: "EURJPY", entry_price: 175, exit_price: 175.5 },
      { ...base, instrument: "ABCXYZ", entry_price: 10, exit_price: 10.5 },
    ]) {
      const out = compute(t);
      const expected = computePnlAbsolute(
        t.entry_price as number,
        t.exit_price as number,
        t.quantity,
        t.direction,
        t.fees,
        t.instrument,
      );
      expect(out.pnl_absolute).toBeCloseTo(expected, 10);
    }
  });
});
