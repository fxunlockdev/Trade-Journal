import { describe, expect, it } from "vitest";
import {
  computePosterStats,
  formatAvgR,
  formatPips,
  formatRowPips,
  windowTradeLog,
  formatWinRate,
  resolveCloseDate,
  tradeResult,
  tradesInRange,
} from "@/lib/posters/poster-data";
import {
  dayKey,
  formatPeriodLabel,
  formatRangeLabel,
  periodKind,
  resolvePeriod,
} from "@/lib/posters/periods";
import type { Trade } from "@/types/database";

/**
 * A poster is a public claim about performance, so these tests are less about
 * code coverage and more about pinning what each number MEANS. Every case here
 * is one a trader could actually hit and be embarrassed by.
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
    pnl_absolute: 10,
    r_multiple: 1,
    entry_time: "2026-08-25T12:00:00Z",
    exit_time: null,
    tp1: null,
    tp1_result: null,
    ...o,
  }) as unknown as Trade;

/** Local-midnight date, so tests read in the same timezone the code buckets in. */
const local = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

describe("tradeResult — from money, never from TP flags", () => {
  it("classifies by P&L sign", () => {
    expect(tradeResult(mk({ pnl_absolute: 12 }))).toBe("win");
    expect(tradeResult(mk({ pnl_absolute: -5 }))).toBe("loss");
    expect(tradeResult(mk({ pnl_absolute: 0 }))).toBe("breakeven");
  });

  it("a TP-hit trade that lost money after fees is a LOSS", () => {
    // trade-table's deriveStatus would call this a win because tp1_result is
    // "hit". A poster must not claim a win on a trade that cost money.
    const t = mk({ tp1: 1.105, tp1_result: "hit", pnl_absolute: -2.5 });
    expect(tradeResult(t)).toBe("loss");
  });
});

describe("resolveCloseDate — close time, entry as fallback", () => {
  it("prefers a real exit_time", () => {
    const t = mk({
      entry_time: "2026-08-24T09:00:00Z",
      exit_time: "2026-08-26T15:00:00Z",
    });
    const { date, fromExit } = resolveCloseDate(t);
    expect(fromExit).toBe(true);
    expect(date.toISOString()).toBe("2026-08-26T15:00:00.000Z");
  });

  it("falls back to entry_time when there is no close time", () => {
    const t = mk({ entry_time: "2026-08-24T09:00:00Z", exit_time: null });
    const { date, fromExit } = resolveCloseDate(t);
    expect(fromExit).toBe(false);
    expect(date.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("treats an unparseable exit_time as absent rather than crashing", () => {
    const t = mk({ entry_time: "2026-08-24T09:00:00Z", exit_time: "not-a-date" });
    const { date, fromExit } = resolveCloseDate(t);
    expect(fromExit).toBe(false);
    expect(date.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  /**
   * Why `exit_time` must never be server-stamped at edit time.
   *
   * A real incident: two trades entered Fri 21 Aug were marked closed on Thu
   * 27 Aug during a catch-up session. The PATCH route stamped `exit_time =
   * now()`, so the weekly poster for 24-30 Aug counted them and published 8
   * trades where the journal listed 6, with 20 pips of losses that belonged to
   * the previous week.
   *
   * These two cases pin the mechanism, so anyone tempted to reintroduce the
   * stamp can see what it costs. `exit_time` is a factual claim about the
   * market; only the user or a broker fill may supply it.
   */
  it("keeps a late-recorded close in the week it was ENTERED when no close time exists", () => {
    const week = resolvePeriod("this-week", new Date(2026, 7, 27, 10, 0));
    const entered21st = mk({
      entry_time: "2026-08-21T15:42:00Z",
      exit_time: null,
      pnl_absolute: -100,
    });
    expect(tradesInRange([entered21st], week)).toHaveLength(0);
  });

  it("would drag that trade into the wrong week if a close time were invented", () => {
    const week = resolvePeriod("this-week", new Date(2026, 7, 27, 10, 0));
    const stamped = mk({
      entry_time: "2026-08-21T15:42:00Z",
      // What `new Date().toISOString()` at edit time produced: the moment of
      // the EDIT, six days after the trade was entered.
      exit_time: "2026-08-27T10:13:36.208Z",
      pnl_absolute: -100,
    });
    expect(tradesInRange([stamped], week)).toHaveLength(1);
  });
});

describe("tradesInRange", () => {
  const range = resolvePeriod("today", new Date(2026, 7, 25, 10, 0));

  it("includes a trade closed today", () => {
    expect(tradesInRange([mk({ exit_time: local(2026, 8, 25, 14) })], range)).toHaveLength(1);
  });

  it("excludes a trade that closed yesterday", () => {
    expect(tradesInRange([mk({ exit_time: local(2026, 8, 24, 14) })], range)).toHaveLength(0);
  });

  it("excludes OPEN trades even if they were entered today", () => {
    const open = mk({ pnl_absolute: null, entry_time: local(2026, 8, 25, 9) });
    expect(tradesInRange([open], range)).toHaveLength(0);
  });

  it("buckets a multi-day trade by its CLOSE date, not its entry", () => {
    // Opened Monday, closed Wednesday -> belongs to Wednesday.
    const t = mk({
      entry_time: local(2026, 8, 23, 9),
      exit_time: local(2026, 8, 25, 16),
    });
    expect(tradesInRange([t], range)).toHaveLength(1);
    const mondayRange = resolvePeriod("today", new Date(2026, 7, 23, 10, 0));
    expect(tradesInRange([t], mondayRange)).toHaveLength(0);
  });

  it("is half-open: midnight belongs to the day starting, not the one ending", () => {
    const atMidnight = mk({ exit_time: local(2026, 8, 25, 0, 0) });
    expect(tradesInRange([atMidnight], range)).toHaveLength(1);
    const yesterday = resolvePeriod("yesterday", new Date(2026, 7, 25, 10, 0));
    expect(tradesInRange([atMidnight], yesterday)).toHaveLength(0);
  });

  it("a 23:30 close lands on that local day, not the next", () => {
    const late = mk({ exit_time: local(2026, 8, 25, 23, 30) });
    expect(tradesInRange([late], range)).toHaveLength(1);
  });
});

describe("computePosterStats", () => {
  it("counts wins, losses and breakevens separately", () => {
    const stats = computePosterStats([
      mk({ pnl_absolute: 10 }),
      mk({ pnl_absolute: 20 }),
      mk({ pnl_absolute: -5 }),
      mk({ pnl_absolute: 0 }),
    ]);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.breakeven).toBe(1);
    expect(stats.tradeCount).toBe(4);
  });

  it("win rate EXCLUDES breakevens from the denominator", () => {
    // 2 wins, 1 loss, 1 BE. Counting the BE as a loss would say 50%.
    const stats = computePosterStats([
      mk({ pnl_absolute: 10 }),
      mk({ pnl_absolute: 20 }),
      mk({ pnl_absolute: -5 }),
      mk({ pnl_absolute: 0 }),
    ]);
    expect(stats.winRate).toBeCloseTo(66.6667, 3);
  });

  it("win rate is 0 rather than NaN when every trade is a breakeven", () => {
    const stats = computePosterStats([mk({ pnl_absolute: 0 })]);
    expect(stats.winRate).toBe(0);
    expect(Number.isNaN(stats.winRate)).toBe(false);
  });

  it("averages REALIZED R and reports its coverage", () => {
    const stats = computePosterStats([
      mk({ r_multiple: 2 }),
      mk({ r_multiple: -1 }),
      mk({ r_multiple: null }), // no stop loss -> no R
    ]);
    expect(stats.avgR).toBeCloseTo(0.5, 6);
    expect(stats.rCovered).toBe(2);
    expect(stats.tradeCount).toBe(3);
  });

  it("avg R is null, not 0, when no trade carries one", () => {
    // Printing "0.0R" would claim a measured breakeven expectancy that was
    // never measured at all.
    const stats = computePosterStats([mk({ r_multiple: null })]);
    expect(stats.avgR).toBeNull();
    expect(formatAvgR(stats.avgR)).toBe("–");
  });

  it("counts how many trades used a real close time", () => {
    const stats = computePosterStats([
      mk({ exit_time: local(2026, 8, 25, 12) }),
      mk({ exit_time: null }),
      mk({ exit_time: null }),
    ]);
    expect(stats.closeTimeKnown).toBe(1);
    expect(stats.tradeCount).toBe(3);
  });

  it("names the pair when the period is one instrument, else ALL PAIRS", () => {
    expect(computePosterStats([mk(), mk()]).asset).toBe("EURUSD");
    expect(
      computePosterStats([mk(), mk({ instrument: "XAUUSD" })]).asset,
    ).toBe("ALL PAIRS");
  });

  it("claims no asset at all when there are no trades", () => {
    // "ALL PAIRS" over +0 pips asserts a subject that isn't there.
    expect(computePosterStats([]).asset).toBe("–");
  });

  it("wins + losses + breakeven always equals tradeCount", () => {
    const trades = [
      mk({ pnl_absolute: 10 }),
      mk({ pnl_absolute: -5 }),
      mk({ pnl_absolute: 0 }),
      mk({ pnl_absolute: 7 }),
    ];
    const s = computePosterStats(trades);
    expect(s.wins + s.losses + s.breakeven).toBe(s.tradeCount);
  });

  it("sums pips off the same helper the trade table uses", () => {
    // 1.1 -> 1.101 on EURUSD = 10 pips, twice.
    const stats = computePosterStats([mk(), mk()]);
    expect(stats.pips).toBeCloseTo(20, 6);
  });

  it("gets JPY pips right (0.01 pip size, not 0.0001)", () => {
    const jpy = mk({
      instrument: "USDJPY",
      entry_price: 150.0,
      exit_price: 150.2,
    });
    expect(computePosterStats([jpy]).pips).toBeCloseTo(20, 6);
  });

  it("orders the trade log chronologically by close date", () => {
    const stats = computePosterStats([
      mk({ instrument: "GBPUSD", exit_time: local(2026, 8, 25, 16) }),
      mk({ instrument: "EURUSD", exit_time: local(2026, 8, 25, 9) }),
    ]);
    expect(stats.log.map((r) => r.pair)).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("log rows carry the money-derived result", () => {
    const stats = computePosterStats([
      mk({ tp1: 1.105, tp1_result: "hit", pnl_absolute: -2.5 }),
    ]);
    expect(stats.log[0].result).toBe("loss");
  });

  it("is empty-set safe", () => {
    const stats = computePosterStats([]);
    expect(stats.tradeCount).toBe(0);
    expect(stats.pips).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgR).toBeNull();
    expect(stats.log).toEqual([]);
    expect(stats.asset).toBe("–");
  });
});

describe("resolvePeriod", () => {
  it("today is a single calendar day", () => {
    const r = resolvePeriod("today", new Date(2026, 7, 25, 13, 45));
    expect(dayKey(r.firstDay)).toBe(20260825);
    expect(dayKey(r.lastDay)).toBe(20260825);
  });

  it("yesterday is the day before today, with no gap or overlap", () => {
    const now = new Date(2026, 7, 25, 13, 45);
    const y = resolvePeriod("yesterday", now);
    const t = resolvePeriod("today", now);
    expect(dayKey(y.lastDay)).toBe(20260824);
    expect(dayKey(t.firstDay)).toBe(20260825);
  });

  it("weeks start on Monday and span seven days", () => {
    // 2026-08-25 is a Tuesday.
    const r = resolvePeriod("this-week", new Date(2026, 7, 25, 13, 45));
    expect(r.firstDay.getDay()).toBe(1);
    expect(dayKey(r.firstDay)).toBe(20260824);
    expect(dayKey(r.lastDay)).toBe(20260830);
  });

  it("a Sunday belongs to the week that started the previous Monday", () => {
    const r = resolvePeriod("this-week", new Date(2026, 7, 30, 13, 45));
    expect(dayKey(r.firstDay)).toBe(20260824);
    expect(dayKey(r.lastDay)).toBe(20260830);
  });

  it("last week is the seven days before this week", () => {
    const now = new Date(2026, 7, 25, 13, 45);
    expect(dayKey(resolvePeriod("last-week", now).lastDay)).toBe(20260823);
    expect(dayKey(resolvePeriod("this-week", now).firstDay)).toBe(20260824);
  });

  it("this month runs 1st to last day", () => {
    const r = resolvePeriod("this-month", new Date(2026, 7, 25, 13, 45));
    expect(dayKey(r.firstDay)).toBe(20260801);
    expect(dayKey(r.lastDay)).toBe(20260831);
  });

  it("last month handles a 31 -> 28 day rollover without overflowing", () => {
    // Naive month arithmetic on Mar 31 lands in May.
    const r = resolvePeriod("last-month", new Date(2026, 2, 31, 13, 45));
    expect(dayKey(r.firstDay)).toBe(20260201);
    expect(dayKey(r.lastDay)).toBe(20260228);
  });

  it("handles a leap February", () => {
    const r = resolvePeriod("this-month", new Date(2028, 1, 10, 13, 45));
    expect(dayKey(r.lastDay)).toBe(20280229);
  });

  it("last month crosses a year boundary", () => {
    const r = resolvePeriod("last-month", new Date(2026, 0, 15, 13, 45));
    expect(dayKey(r.firstDay)).toBe(20251201);
    expect(dayKey(r.lastDay)).toBe(20251231);
  });

  it("consecutive periods never gap or overlap", () => {
    const now = new Date(2026, 7, 25, 13, 45);
    for (const [a, b] of [
      ["yesterday", "today"],
      ["last-week", "this-week"],
      ["last-month", "this-month"],
    ] as const) {
      const prev = resolvePeriod(a, now);
      const next = resolvePeriod(b, now);
      const dayAfterPrev = new Date(prev.lastDay);
      dayAfterPrev.setDate(dayAfterPrev.getDate() + 1);
      expect(dayKey(dayAfterPrev)).toBe(dayKey(next.firstDay));
    }
  });

  it("a trade at 23:59 and one at 00:01 land on their own local days", () => {
    const now = new Date(2026, 7, 25, 13, 45);
    const today = resolvePeriod("today", now);
    const late = mk({ exit_time: local(2026, 8, 25, 23, 59) });
    const earlyNextDay = mk({ exit_time: local(2026, 8, 26, 0, 1) });
    expect(tradesInRange([late], today)).toHaveLength(1);
    expect(tradesInRange([earlyNextDay], today)).toHaveLength(0);
  });
});

describe("labels", () => {
  it("names the period kind", () => {
    expect(periodKind("today")).toBe("DAILY");
    expect(periodKind("last-week")).toBe("WEEKLY");
    expect(periodKind("this-month")).toBe("MONTHLY");
  });

  it("a single day prints one date", () => {
    const r = resolvePeriod("today", new Date(2026, 7, 25, 10));
    expect(formatRangeLabel(r)).toBe("25 Aug 2026");
  });

  it("a week prints the INCLUSIVE last day, not the exclusive end", () => {
    // The range ends 31 Aug 00:00; advertising "31" would include a day whose
    // trades are not in the numbers.
    const r = resolvePeriod("this-week", new Date(2026, 7, 25, 10));
    expect(formatRangeLabel(r)).toBe("24 – 30 Aug 2026");
  });

  it("a month prints as a month name", () => {
    const r = resolvePeriod("this-month", new Date(2026, 7, 25, 10));
    expect(formatPeriodLabel("this-month", r)).toBe("August 2026");
  });

  it("a range spanning two months names both", () => {
    const crossing = resolvePeriod("this-week", new Date(2026, 8, 2, 10));
    expect(formatRangeLabel(crossing)).toBe("31 Aug – 6 Sep 2026");
  });

  it("a week label names the last day that is actually included", () => {
    const r = resolvePeriod("this-week", new Date(2026, 7, 25, 10));
    expect(formatRangeLabel(r)).toBe("24 – 30 Aug 2026");
  });
});

describe("formatting", () => {
  it("the headline is whole pips, signed, rounded once from the true sum", () => {
    expect(formatPips(247)).toBe("+247");
    expect(formatPips(-89)).toBe("-89");
    expect(formatPips(0)).toBe("0");
    expect(formatPips(209.8)).toBe("+210");
  });

  it("log rows carry a decimal so the column reconciles with the headline", () => {
    // 20 trades of 10.49 pips: whole-pip rows would show +10 each and sum to
    // 200 under a headline of +210 — visibly wrong on the same image.
    const rows = Array.from({ length: 20 }, () => 10.49);
    const printed = rows.map(formatRowPips);
    expect(printed[0]).toBe("+10.5");
    const summed = printed.reduce((s, v) => s + Number(v), 0);
    const headline = Number(formatPips(rows.reduce((s, v) => s + v, 0)));
    expect(Math.abs(summed - headline)).toBeLessThanOrEqual(1);
  });

  it("win rate rounds to a whole percent", () => {
    expect(formatWinRate(66.6667)).toBe("67%");
    expect(formatWinRate(0)).toBe("0%");
  });

  it("avg R shows one decimal and keeps its sign", () => {
    expect(formatAvgR(1.25)).toBe("1.3R");
    expect(formatAvgR(-0.4)).toBe("-0.4R");
    expect(formatAvgR(null)).toBe("–");
  });
});

describe("windowTradeLog — what a fixed-size poster can print", () => {
  const row = (i: number, pips: number | null) =>
    ({
      id: `r${i}`,
      date: `${String(i + 1).padStart(2, "0")} Aug`,
      pair: "EURUSD",
      direction: "buy" as const,
      entry: "1.10000",
      pips,
      result: "win" as const,
    });

  it("prints everything when it fits", () => {
    const log = [row(0, 10), row(1, 20)];
    const w = windowTradeLog(log, 20);
    expect(w.visible).toHaveLength(2);
    expect(w.hiddenCount).toBe(0);
    expect(w.hiddenPips).toBe(0);
  });

  it("keeps the MOST RECENT rows, not the earliest", () => {
    // Chronological log; a naive slice(0, n) would print the start of the week
    // and drop the weekend — the opposite of "this week's results".
    const log = Array.from({ length: 30 }, (_, i) => row(i, 1));
    const w = windowTradeLog(log, 20);
    expect(w.visible).toHaveLength(20);
    expect(w.visible[0].id).toBe("r10");
    expect(w.visible[19].id).toBe("r29");
    expect(w.hiddenCount).toBe(10);
  });

  it("reports the pips carried by the dropped rows", () => {
    const log = Array.from({ length: 25 }, (_, i) => row(i, i < 5 ? -8 : 4));
    const w = windowTradeLog(log, 20);
    // The 5 dropped rows are the earliest, at -8 each.
    expect(w.hiddenCount).toBe(5);
    expect(w.hiddenPips).toBeCloseTo(-40, 6);
  });

  it("visible pips + hidden pips reconcile with the whole log", () => {
    // This is the property the note exists to preserve: a reader adding the
    // printed column and the note lands on the headline.
    const log = Array.from({ length: 30 }, (_, i) => row(i, i % 4 === 3 ? -12 : 9));
    const w = windowTradeLog(log, 20);
    const visibleSum = w.visible.reduce((a, r) => a + (r.pips ?? 0), 0);
    const total = log.reduce((a, r) => a + (r.pips ?? 0), 0);
    expect(visibleSum + w.hiddenPips).toBeCloseTo(total, 6);
  });

  it("skips rows with no computable pips, like the total does", () => {
    const log = [row(0, null), row(1, 10), row(2, 5), row(3, 5)];
    const w = windowTradeLog(log, 2);
    expect(w.hiddenCount).toBe(2);
    expect(w.hiddenPips).toBeCloseTo(10, 6);
  });

  it("is safe at the boundary and with a nonsense limit", () => {
    const log = Array.from({ length: 20 }, (_, i) => row(i, 1));
    expect(windowTradeLog(log, 20).hiddenCount).toBe(0);
    expect(windowTradeLog(log, 0).visible).toHaveLength(20);
    expect(windowTradeLog([], 20).visible).toHaveLength(0);
  });
});
