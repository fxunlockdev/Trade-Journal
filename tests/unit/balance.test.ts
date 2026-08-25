import { describe, expect, it } from "vitest";
import {
  combinedStartingCapital,
  computeCurrentBalance,
  computeEquityTimeline,
  computeMaxDrawdownPercent,
  effectiveRiskPercent,
  isAccountWiped,
  realizedPnl,
  riskBaseBalance,
} from "@/lib/trades/balance";
import {
  computeExpectancy,
  computeExpectancyR,
  computePayoffRatio,
} from "@/lib/trades/analytics";
import { computeAutoSize } from "@/lib/trades/auto-size";
import { formatValue, pickModeValue } from "@/components/analytics/equity-curve";
import type { Trade } from "@/types/database";

/**
 * The account balance is DERIVED (capital + closed P&L), never stored, so it
 * can't go stale when a trade is edited or deleted. Risk % is taken from that
 * live balance when the journal compounds — that's the "accumulated interest"
 * effect: a grown account risks more per trade, a drawn-down one risks less.
 */

let n = 0;
const mk = (pnl: number | null, o: Partial<Trade> = {}): Trade =>
  ({
    id: `t${n++}`,
    instrument: "EURUSD",
    direction: "buy",
    entry_price: 1.1,
    exit_price: pnl === null ? null : 1.11,
    quantity: 10_000,
    fees: 0,
    stop_loss: 1.09,
    pnl_absolute: pnl,
    r_multiple: null,
    entry_time: `2026-07-${String(10 + n).padStart(2, "0")}T12:00:00Z`,
    ...o,
  }) as unknown as Trade;

describe("realizedPnl / computeCurrentBalance", () => {
  it("sums closed trades and ignores open ones", () => {
    expect(realizedPnl([mk(100), mk(-40), mk(null), mk(25)])).toBeCloseTo(85, 6);
  });

  it("ignores a non-finite P&L rather than poisoning the total", () => {
    expect(realizedPnl([mk(100), mk(Number.NaN)])).toBeCloseTo(100, 6);
  });

  it("balance = capital + realized P&L", () => {
    expect(computeCurrentBalance(10_000, [mk(500), mk(-200)])).toBeCloseTo(10_300, 6);
  });

  it("a losing run reduces the balance below the capital", () => {
    expect(computeCurrentBalance(10_000, [mk(-1_500)])).toBeCloseTo(8_500, 6);
  });

  it("no capital configured → null (no account to track)", () => {
    expect(computeCurrentBalance(null, [mk(500)])).toBeNull();
    expect(computeCurrentBalance(0, [mk(500)])).toBeNull();
    expect(computeCurrentBalance(undefined, [])).toBeNull();
  });

  it("no trades yet → balance is exactly the capital", () => {
    expect(computeCurrentBalance(10_000, [])).toBeCloseTo(10_000, 6);
  });
});

describe("riskBaseBalance", () => {
  it("compounding uses the live balance", () => {
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: 12_500, basis: "compounding" }),
    ).toEqual({ base: 12_500, depleted: false });
  });

  it("fixed pins to the starting capital even after growth", () => {
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: 12_500, basis: "fixed" }),
    ).toEqual({ base: 10_000, depleted: false });
  });

  it("compounding shrinks the base during a drawdown", () => {
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: 8_000, basis: "compounding" }),
    ).toEqual({ base: 8_000, depleted: false });
  });

  it("a wiped account is FLAGGED, not silently sized as if funded", () => {
    // The fallback exists so nothing divides by zero, but callers must be able
    // to see it happened — presenting starting capital as the "current balance"
    // of a blown account is how a -$500 account gets a full-size position.
    for (const wiped of [0, -500]) {
      expect(
        riskBaseBalance({ startingCapital: 10_000, currentBalance: wiped, basis: "compounding" }),
      ).toEqual({ base: 10_000, depleted: true });
    }
  });

  it("fixed basis never reports depleted — it doesn't consult the balance", () => {
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: -500, basis: "fixed" }),
    ).toEqual({ base: 10_000, depleted: false });
  });

  it("no capital → null base regardless of basis", () => {
    expect(
      riskBaseBalance({ startingCapital: null, currentBalance: 5_000, basis: "compounding" }),
    ).toEqual({ base: null, depleted: false });
  });

  it("an unknown balance degrades to the capital WITHOUT crying wipeout", () => {
    // Balance not fetched yet is not the same as a blown account.
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: undefined, basis: "compounding" }),
    ).toEqual({ base: 10_000, depleted: false });
    expect(
      riskBaseBalance({ startingCapital: 10_000, currentBalance: null, basis: "compounding" }),
    ).toEqual({ base: 10_000, depleted: false });
  });

  it("the balance card and the trade form derive the same base", () => {
    // Both surfaces must call this helper rather than re-deriving it, or they
    // quote different money for the same next trade.
    const args = {
      startingCapital: 10_000,
      currentBalance: 12_470,
      basis: "compounding" as const,
    };
    expect(riskBaseBalance(args).base).toBe(riskBaseBalance(args).base);
    expect(riskBaseBalance(args).base).toBe(12_470);
  });
});

describe("effectiveRiskPercent — per-trade money management", () => {
  it("the trade's own risk % wins", () => {
    expect(effectiveRiskPercent({ tradeRiskPercent: 0.5, journalDefault: 1 })).toBe(0.5);
  });

  it("falls back to the journal default when the trade has none", () => {
    expect(effectiveRiskPercent({ tradeRiskPercent: null, journalDefault: 2 })).toBe(2);
  });

  it("ignores a zero or negative override", () => {
    expect(effectiveRiskPercent({ tradeRiskPercent: 0, journalDefault: 2 })).toBe(2);
    expect(effectiveRiskPercent({ tradeRiskPercent: -1, journalDefault: 2 })).toBe(2);
  });

  it("last-resort default is 1%", () => {
    expect(effectiveRiskPercent({})).toBe(1);
  });
});

describe("compounding actually changes position size", () => {
  const sizeAt = (capital: number, riskPercent = 1) =>
    computeAutoSize({
      capital,
      accountCurrency: "USD",
      riskPercent,
      instrument: "EURUSD",
      direction: "buy",
      entryPrice: 1.1,
      stopLossPrice: 1.095, // 50 pips
    })!;

  it("a 25% grown account risks 25% more money and buys 25% more size", () => {
    const start = sizeAt(10_000);
    const grown = sizeAt(12_500);
    expect(grown.riskAmount).toBeCloseTo(start.riskAmount * 1.25, 6);
    expect(grown.quantity).toBeCloseTo(start.quantity * 1.25, 4);
  });

  it("a drawdown reduces size proportionally", () => {
    const start = sizeAt(10_000);
    const drawn = sizeAt(8_000);
    expect(drawn.quantity).toBeCloseTo(start.quantity * 0.8, 4);
  });

  it("reports which balance it sized from", () => {
    expect(sizeAt(12_500).basisBalance).toBe(12_500);
  });

  it("a per-trade risk override scales the size", () => {
    expect(sizeAt(10_000, 2).quantity).toBeCloseTo(sizeAt(10_000, 1).quantity * 2, 4);
  });

  it("compounding vs fixed produce different sizes on a grown account", () => {
    const compounding = riskBaseBalance({
      startingCapital: 10_000, currentBalance: 12_500, basis: "compounding",
    }).base!;
    const fixed = riskBaseBalance({
      startingCapital: 10_000, currentBalance: 12_500, basis: "fixed",
    }).base!;
    expect(sizeAt(compounding).quantity).toBeGreaterThan(sizeAt(fixed).quantity);
  });
});

describe("computeEquityTimeline", () => {
  const trades = [
    mk(500, { entry_time: "2026-07-01T12:00:00Z", r_multiple: 2 }),
    mk(-200, { entry_time: "2026-07-02T12:00:00Z", r_multiple: -1 }),
    mk(300, { entry_time: "2026-07-03T12:00:00Z", r_multiple: 1.5 }),
    mk(null, { entry_time: "2026-07-04T12:00:00Z" }), // open — excluded
  ];

  it("plots the account balance starting from the capital", () => {
    const tl = computeEquityTimeline(trades, 10_000);
    expect(tl.map((p) => p.balance)).toEqual([10_500, 10_300, 10_600]);
  });

  it("keeps cumulative P&L alongside the balance", () => {
    const tl = computeEquityTimeline(trades, 10_000);
    expect(tl.map((p) => p.cumPnl)).toEqual([500, 300, 600]);
  });

  it("return % is measured against the starting capital", () => {
    const tl = computeEquityTimeline(trades, 10_000);
    expect(tl[tl.length - 1].returnPercent).toBeCloseTo(6, 6);
  });

  it("accumulates R across trades", () => {
    const tl = computeEquityTimeline(trades, 10_000);
    expect(tl.map((p) => p.cumR)).toEqual([2, 1, 2.5]);
  });

  it("excludes open trades", () => {
    expect(computeEquityTimeline(trades, 10_000)).toHaveLength(3);
  });

  it("orders by entry time even when the input is shuffled", () => {
    const shuffled = [trades[2], trades[0], trades[1]];
    expect(computeEquityTimeline(shuffled, 10_000).map((p) => p.balance)).toEqual([
      10_500, 10_300, 10_600,
    ]);
  });

  it("without capital it degrades to the old cumulative-P&L series", () => {
    const tl = computeEquityTimeline(trades, null);
    expect(tl.map((p) => p.balance)).toEqual([500, 300, 600]);
    expect(tl.every((p) => p.returnPercent === 0)).toBe(true);
  });

  it("is empty-set safe", () => {
    expect(computeEquityTimeline([], 10_000)).toEqual([]);
  });
});

describe("equity curve lenses ($ / Return % / R)", () => {
  const point = {
    date: "2026-07-03T12:00:00Z",
    cumPnl: 600,
    balance: 10_600,
    returnPercent: 6,
    cumR: 2.5,
  };

  it("each lens reads a different series off the same point", () => {
    expect(pickModeValue(point, "balance")).toBe(10_600);
    expect(pickModeValue(point, "percent")).toBe(6);
    expect(pickModeValue(point, "r")).toBe(2.5);
  });

  it("formats each lens in its own unit", () => {
    expect(formatValue(10_600, "balance")).toBe("$10,600.00");
    expect(formatValue(6, "percent")).toBe("6.00%");
    expect(formatValue(2.5, "r")).toBe("+2.50R");
  });

  it("keeps the sign on losses", () => {
    expect(formatValue(-4.25, "percent")).toBe("-4.25%");
    expect(formatValue(-1.5, "r")).toBe("-1.50R");
  });

  it("the three lenses agree on direction at every point", () => {
    const tl = computeEquityTimeline(
      [
        mk(500, { entry_time: "2026-07-01T12:00:00Z", r_multiple: 2 }),
        mk(-200, { entry_time: "2026-07-02T12:00:00Z", r_multiple: -1 }),
        mk(300, { entry_time: "2026-07-03T12:00:00Z", r_multiple: 1.5 }),
      ],
      10_000,
    );
    // A down leg must be down in dollars, in percent and in R alike — the
    // toggle changes the unit, never the story.
    const legs = (mode: "balance" | "percent" | "r") =>
      tl.slice(1).map((p, i) => Math.sign(pickModeValue(p, mode) - pickModeValue(tl[i], mode)));
    expect(legs("percent")).toEqual(legs("balance"));
    expect(legs("r")).toEqual(legs("balance"));
  });
});

describe("dashboard metrics — account-relative readings", () => {
  it("drawdown % measures against the peak balance, not the capital", () => {
    // 10k -> 12k (peak) -> 9.6k. Trough is 20% below the 12k peak, even though
    // it's only 4% below the starting capital.
    const dd = computeMaxDrawdownPercent(
      [
        mk(2_000, { entry_time: "2026-07-01T12:00:00Z" }),
        mk(-2_400, { entry_time: "2026-07-02T12:00:00Z" }),
      ],
      10_000,
    );
    expect(dd).toBeCloseTo(20, 6);
  });

  it("a first-trade loss is a drawdown from the opening balance", () => {
    expect(
      computeMaxDrawdownPercent([mk(-500)], 10_000),
    ).toBeCloseTo(5, 6);
  });

  it("an account that only grows has no drawdown", () => {
    expect(
      computeMaxDrawdownPercent([mk(500), mk(300)], 10_000),
    ).toBe(0);
  });

  it("keeps the deepest trough, not the last one", () => {
    // 10k -> 8k (20% dd) -> 11k -> 10.45k (5% dd). Worst stays 20%.
    const dd = computeMaxDrawdownPercent(
      [
        mk(-2_000, { entry_time: "2026-07-01T12:00:00Z" }),
        mk(3_000, { entry_time: "2026-07-02T12:00:00Z" }),
        mk(-550, { entry_time: "2026-07-03T12:00:00Z" }),
      ],
      10_000,
    );
    expect(dd).toBeCloseTo(20, 6);
  });

  it("is null without capital — a % needs a denominator", () => {
    expect(computeMaxDrawdownPercent([mk(-500)], null)).toBeNull();
    expect(computeMaxDrawdownPercent([], 10_000)).toBeNull();
  });

  it("caps at 100% instead of reporting a nonsense 150%", () => {
    // -$15,000 on a $10,000 account is mathematically a 150% drawdown of peak.
    // "Max Drawdown 150.00%" reads as a bug, so it clamps and the caller says
    // the account was wiped.
    expect(computeMaxDrawdownPercent([mk(-15_000)], 10_000)).toBe(100);
    expect(
      computeMaxDrawdownPercent(
        [
          mk(-12_000, { entry_time: "2026-07-01T12:00:00Z" }),
          mk(3_000, { entry_time: "2026-07-02T12:00:00Z" }),
        ],
        10_000,
      ),
    ).toBe(100);
  });

  it("flags a wiped account separately so the cap doesn't hide it", () => {
    expect(isAccountWiped([mk(-15_000)], 10_000)).toBe(true);
    expect(isAccountWiped([mk(-10_000)], 10_000)).toBe(true); // exactly zero
    expect(isAccountWiped([mk(-9_999)], 10_000)).toBe(false);
    expect(isAccountWiped([mk(500)], null)).toBe(false); // no account to wipe
  });

  it("expectancy is the average money per closed trade", () => {
    expect(computeExpectancy([mk(300), mk(-100), mk(200)])).toBeCloseTo(400 / 3, 6);
  });

  it("expectancy ignores open trades and is null with no data", () => {
    expect(computeExpectancy([mk(300), mk(null)])).toBeCloseTo(300, 6);
    expect(computeExpectancy([])).toBeNull();
    expect(computeExpectancy([mk(null)])).toBeNull();
  });

  it("expectancy in R averages the R multiples", () => {
    const trades = [
      mk(300, { r_multiple: 2 }),
      mk(-100, { r_multiple: -1 }),
      mk(200, { r_multiple: 1.5 }),
    ];
    const r = computeExpectancyR(trades)!;
    expect(r.value).toBeCloseTo(0.8333333, 5);
    expect(r.covered).toBe(3);
    expect(r.closed).toBe(3);
  });

  it("reports R coverage so a partial average can't masquerade as the whole", () => {
    // One +3R winner among nine stop-less losers: a losing system that would
    // otherwise advertise "+3.00R per trade" beside a negative dollar figure.
    const trades = [
      mk(300, { r_multiple: 3 }),
      ...Array.from({ length: 9 }, () => mk(-50, { r_multiple: null })),
    ];
    const r = computeExpectancyR(trades)!;
    expect(r.value).toBeCloseTo(3, 6);
    expect(r.covered).toBe(1);
    expect(r.closed).toBe(10);
    // The dollar expectancy over ALL ten trades is negative — the mismatch the
    // coverage figure exists to expose.
    expect(computeExpectancy(trades)!).toBeLessThan(0);
  });

  it("expectancy in R is null when no trade carries an R multiple", () => {
    expect(computeExpectancyR([mk(300, { r_multiple: null })])).toBeNull();
  });

  it("payoff ratio compares average win to average loss", () => {
    // avg win 300, avg loss -100 -> 3:1
    expect(computePayoffRatio([mk(200), mk(400), mk(-100)])).toBeCloseTo(3, 6);
  });

  it("payoff ratio is null with no losses (unbounded) or no data", () => {
    expect(computePayoffRatio([mk(200)])).toBeNull();
    expect(computePayoffRatio([])).toBeNull();
  });

  it("a losses-only account has a payoff ratio of ZERO, not 'no data'", () => {
    // Greying this out as "Not enough data" would hide the most alarming
    // reading on the card.
    expect(computePayoffRatio([mk(-100), mk(-200)])).toBe(0);
  });

  it("a negative expectancy system is flagged even with a winning majority", () => {
    // 3 small wins, 1 big loss: 75% win rate but the system loses money.
    const trades = [mk(50), mk(50), mk(50), mk(-400)];
    expect(computeExpectancy(trades)!).toBeLessThan(0);
  });
});

describe("combinedStartingCapital (Portfolio)", () => {
  it("sums the capital of the journals in scope", () => {
    expect(
      combinedStartingCapital([
        { initial_capital: 10_000 },
        { initial_capital: 5_000 },
      ]),
    ).toBe(15_000);
  });

  it("skips journals with no capital", () => {
    expect(
      combinedStartingCapital([{ initial_capital: 10_000 }, { initial_capital: null }]),
    ).toBe(10_000);
  });

  it("returns null when none of them have capital", () => {
    expect(combinedStartingCapital([{ initial_capital: null }])).toBeNull();
    expect(combinedStartingCapital([])).toBeNull();
  });
});
