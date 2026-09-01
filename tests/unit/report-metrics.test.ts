import { describe, expect, it } from "vitest";
import {
  computeReportMetrics,
  resolveCurrency,
  rollupDays,
} from "@/lib/reports/metrics";
import type { Trade } from "@/types/database";

/**
 * These numbers get published to a group of partners. The tests are less about
 * coverage than about pinning what each figure MEANS, and about the cases where
 * a plausible-looking number would be a lie.
 */

let seq = 0;
const mk = (o: Partial<Trade> = {}): Trade =>
  ({
    id: `t${seq++}`,
    instrument: "EURUSD",
    asset_type: "forex",
    direction: "buy",
    entry_price: 1.1,
    exit_price: 1.101,
    quantity: 10_000,
    fees: 0,
    stop_loss: 1.099,
    pnl_absolute: 100,
    pnl_currency: "USD",
    r_multiple: 1,
    entry_time: "2026-08-25T12:00:00Z",
    exit_time: null,
    tp1: null,
    tp1_result: null,
    ...o,
  }) as unknown as Trade;

/** Local midday on a given day, so day bucketing reads in the test's zone. */
const localDay = (y: number, m: number, d: number): string =>
  new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();

const TZ = "Europe/London";

describe("money metrics", () => {
  it("splits gross profit and gross loss so they reconcile to net", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 300 }), mk({ pnl_absolute: 100 }), mk({ pnl_absolute: -150 })],
      TZ,
    );
    expect(m.grossProfit).toBe(400);
    expect(m.grossLoss).toBe(-150);
    // The invariant a reader can check by eye on the poster.
    expect(m.grossProfit! + m.grossLoss!).toBe(m.netPnl);
    expect(m.netPnl).toBe(250);
  });

  it("reports averages over their OWN population, not all trades", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 300 }), mk({ pnl_absolute: 100 }), mk({ pnl_absolute: -150 })],
      TZ,
    );
    expect(m.avgWin).toBe(200);
    expect(m.avgLoss).toBe(-150);
  });

  it("best and worst are the actual extremes, including when all are losses", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: -10 }), mk({ pnl_absolute: -90 })],
      TZ,
    );
    expect(m.bestTrade).toBe(-10);
    expect(m.worstTrade).toBe(-90);
  });

  it("profit factor is NULL with no losses, never Infinity", () => {
    // "∞" on a marketing image invites exactly the wrong read.
    const m = computeReportMetrics([mk({ pnl_absolute: 100 })], TZ);
    expect(m.profitFactor).toBeNull();
    expect(m.avgLoss).toBeNull();
  });

  it("breakevens do not count as wins or losses in the money split", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 100 }), mk({ pnl_absolute: 0 }), mk({ pnl_absolute: -40 })],
      TZ,
    );
    expect(m.grossProfit).toBe(100);
    expect(m.grossLoss).toBe(-40);
    expect(m.avgWin).toBe(100);
    expect(m.avgLoss).toBe(-40);
  });

  it("an empty period reports null money rather than zeroes", () => {
    // Zeroes would claim a measured flat period; there was no period.
    const m = computeReportMetrics([], TZ);
    expect(m.netPnl).toBeNull();
    expect(m.grossProfit).toBeNull();
    expect(m.bestTrade).toBeNull();
    expect(m.profitFactor).toBeNull();
    expect(m.stats.tradeCount).toBe(0);
  });

  it("ignores OPEN trades entirely", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 100 }), mk({ pnl_absolute: null })],
      TZ,
    );
    expect(m.stats.tradeCount).toBe(1);
    expect(m.netPnl).toBe(100);
  });
});

describe("currency safety", () => {
  it("withholds ALL money when the period mixes currencies", () => {
    // Summing euros into dollars is the one failure a published figure must
    // never have. Nothing is better than wrong.
    const m = computeReportMetrics(
      [
        mk({ pnl_absolute: 100, pnl_currency: "USD" }),
        mk({ pnl_absolute: 100, pnl_currency: "EUR" }),
      ],
      TZ,
    );
    expect(m.mixedCurrency).toBe(true);
    expect(m.currency).toBeNull();
    expect(m.netPnl).toBeNull();
    expect(m.grossProfit).toBeNull();
    expect(m.bestTrade).toBeNull();
  });

  it("still reports PIPS and R when currencies disagree", () => {
    // Pips and R are currency-free, so a mixed period is not a blank poster.
    const m = computeReportMetrics(
      [
        mk({ pnl_absolute: 100, pnl_currency: "USD", r_multiple: 2 }),
        mk({ pnl_absolute: 100, pnl_currency: "EUR", r_multiple: 1 }),
      ],
      TZ,
    );
    expect(m.stats.tradeCount).toBe(2);
    expect(m.netR).toBe(3);
  });

  it("treats a NULL currency as unknown, not as a disagreement", () => {
    // Rows written before pnl_currency existed. They have always been summed;
    // refusing them now would blank every historical report.
    const m = computeReportMetrics(
      [
        mk({ pnl_absolute: 100, pnl_currency: null }),
        mk({ pnl_absolute: 50, pnl_currency: null }),
      ],
      TZ,
    );
    expect(m.mixedCurrency).toBe(false);
    expect(m.currency).toBeNull();
    expect(m.netPnl).toBe(150);
  });

  it("names the currency when every trade agrees", () => {
    expect(resolveCurrency([mk({ pnl_currency: "GBP" })])).toEqual({
      currency: "GBP",
      mixed: false,
    });
  });
});

describe("net R", () => {
  it("sums realised R over the trades that carry one", () => {
    const m = computeReportMetrics(
      [mk({ r_multiple: 2 }), mk({ r_multiple: -1 }), mk({ r_multiple: 0.5 })],
      TZ,
    );
    expect(m.netR).toBeCloseTo(1.5, 6);
  });

  it("is NULL, not 0, when no trade had a stop loss", () => {
    // 0R claims a measured breakeven expectancy that was never measured.
    const m = computeReportMetrics([mk({ r_multiple: null })], TZ);
    expect(m.netR).toBeNull();
  });
});

describe("day rollups — by NET, and by local close date", () => {
  it("a day of three wins and one bigger loss is a LOSING day", () => {
    // Counting days by trade outcome instead of net would flatter the record.
    const day = localDay(2026, 8, 25);
    const d = rollupDays([
      mk({ exit_time: day, pnl_absolute: 10 }),
      mk({ exit_time: day, pnl_absolute: 10 }),
      mk({ exit_time: day, pnl_absolute: 10 }),
      mk({ exit_time: day, pnl_absolute: -50 }),
    ]);
    expect(d).toEqual({ tradingDays: 1, profitableDays: 0, losingDays: 1 });
  });

  it("a day that nets exactly zero traded but neither won nor lost", () => {
    const day = localDay(2026, 8, 25);
    const d = rollupDays([
      mk({ exit_time: day, pnl_absolute: 40 }),
      mk({ exit_time: day, pnl_absolute: -40 }),
    ]);
    expect(d).toEqual({ tradingDays: 1, profitableDays: 0, losingDays: 0 });
  });

  it("counts distinct days, not trades", () => {
    const d = rollupDays([
      mk({ exit_time: localDay(2026, 8, 24), pnl_absolute: 10 }),
      mk({ exit_time: localDay(2026, 8, 24), pnl_absolute: 10 }),
      mk({ exit_time: localDay(2026, 8, 25), pnl_absolute: -10 }),
    ]);
    expect(d).toEqual({ tradingDays: 2, profitableDays: 1, losingDays: 1 });
  });

  it("buckets by CLOSE date, matching the poster, not by entry", () => {
    // calendar.ts buckets by UTC entry date. If this used that, a report could
    // say "12 trades" and "3 trading days" about different sets of trades.
    const t = mk({
      entry_time: localDay(2026, 8, 20),
      exit_time: localDay(2026, 8, 25),
      pnl_absolute: 10,
    });
    const d = rollupDays([t]);
    expect(d.tradingDays).toBe(1);
    // And the poster agrees it belongs to the 25th.
    const m = computeReportMetrics([t], TZ);
    expect(m.stats.tradeCount).toBe(1);
  });

  it("falls back to the entry date when no close time was recorded", () => {
    const d = rollupDays([
      mk({ entry_time: localDay(2026, 8, 24), exit_time: null, pnl_absolute: 10 }),
    ]);
    expect(d.tradingDays).toBe(1);
  });
});

describe("composition with PosterStats", () => {
  it("carries the pips core through untouched", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 100 }), mk({ pnl_absolute: -50 })],
      TZ,
    );
    expect(m.stats.wins).toBe(1);
    expect(m.stats.losses).toBe(1);
    expect(m.stats.timeZone).toBe(TZ);
  });

  it("wins + losses + breakeven still equals tradeCount", () => {
    const m = computeReportMetrics(
      [mk({ pnl_absolute: 10 }), mk({ pnl_absolute: 0 }), mk({ pnl_absolute: -5 })],
      TZ,
    );
    const s = m.stats;
    expect(s.wins + s.losses + s.breakeven).toBe(s.tradeCount);
  });
});
