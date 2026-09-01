import { describe, expect, it } from "vitest";
import {
  formatPeriodLabel,
  isoDate,
  resolveReportPeriod,
  tradesInReportPeriod,
  zonedNow,
} from "@/lib/reports/periods-tz";
import type { Trade } from "@/types/database";

/**
 * A scheduled report runs on a server in UTC and must answer "yesterday" the
 * way LONDON means it. Get this wrong and every trade near midnight lands in
 * the wrong published report, silently.
 */

const LONDON = "Europe/London";
const TOKYO = "Asia/Tokyo";

let seq = 0;
const mk = (o: Partial<Trade> = {}): Trade =>
  ({
    id: `t${seq++}`,
    pnl_absolute: 100,
    r_multiple: 1,
    entry_time: "2026-08-25T12:00:00Z",
    exit_time: null,
    ...o,
  }) as unknown as Trade;

describe("zonedNow — the wall clock in a given zone", () => {
  it("reads London as BST in summer, an hour ahead of UTC", () => {
    // 2026-09-01T05:30Z is 06:30 in London during BST. A server that assumed
    // UTC would think 06:00 had not yet passed.
    const z = zonedNow(new Date("2026-09-01T05:30:00Z"), LONDON);
    expect(z.hour).toBe(6);
    expect(isoDate(z)).toBe("2026-09-01");
  });

  it("reads London as GMT in winter, level with UTC", () => {
    const z = zonedNow(new Date("2026-12-01T06:30:00Z"), LONDON);
    expect(z.hour).toBe(6);
  });

  it("crosses the date line correctly for a far-east zone", () => {
    // 23:30Z on the 1st is already 08:30 on the 2nd in Tokyo.
    const z = zonedNow(new Date("2026-09-01T23:30:00Z"), TOKYO);
    expect(isoDate(z)).toBe("2026-09-02");
    expect(z.hour).toBe(8);
  });

  it("normalises midnight to hour 0, never 24", () => {
    const z = zonedNow(new Date("2026-09-01T23:00:00Z"), LONDON);
    expect(z.hour).toBe(0);
    expect(z.hour).toBeLessThan(24);
  });
});

describe("daily — yesterday, in the desk's zone", () => {
  it("at 06:00 London on 1 Sep, covers 31 Aug", () => {
    const p = resolveReportPeriod("daily", new Date("2026-09-01T05:00:00Z"), LONDON);
    expect(p).toEqual({ cadence: "daily", start: "2026-08-31", end: "2026-08-31" });
  });

  it("just after London midnight it is still the previous day that closed", () => {
    // 23:10Z on 31 Aug is 00:10 on 1 Sep in London. Yesterday is 31 Aug.
    const p = resolveReportPeriod("daily", new Date("2026-08-31T23:10:00Z"), LONDON);
    expect(p.start).toBe("2026-08-31");
  });

  it("crosses a month boundary without special-casing", () => {
    const p = resolveReportPeriod("daily", new Date("2026-09-01T05:00:00Z"), LONDON);
    expect(p.start).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    const p = resolveReportPeriod("daily", new Date("2027-01-01T06:00:00Z"), LONDON);
    expect(p.start).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    const p = resolveReportPeriod("daily", new Date("2028-03-01T06:00:00Z"), LONDON);
    expect(p.start).toBe("2028-02-29");
  });
});

describe("weekly — the Monday-to-Friday just gone", () => {
  it("run on Saturday, covers the week that just ended", () => {
    // Sat 5 Sep 2026 -> Mon 31 Aug to Fri 4 Sep.
    const p = resolveReportPeriod("weekly", new Date("2026-09-05T05:00:00Z"), LONDON);
    expect(p).toEqual({
      cadence: "weekly",
      start: "2026-08-31",
      end: "2026-09-04",
    });
  });

  it("spans exactly five calendar days", () => {
    const p = resolveReportPeriod("weekly", new Date("2026-09-05T05:00:00Z"), LONDON);
    const days =
      (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 + 1;
    expect(days).toBe(5);
  });

  it("run on a Friday, gives the PREVIOUS week, not the one still running", () => {
    // A report is a closed claim. Friday's own trading is not finished.
    const p = resolveReportPeriod("weekly", new Date("2026-09-04T10:00:00Z"), LONDON);
    expect(p.end).toBe("2026-08-28");
  });

  it("run mid-week, still gives the last completed week", () => {
    // Wed 9 Sep -> the week ending Fri 4 Sep.
    const p = resolveReportPeriod("weekly", new Date("2026-09-09T10:00:00Z"), LONDON);
    expect(p).toEqual({
      cadence: "weekly",
      start: "2026-08-31",
      end: "2026-09-04",
    });
  });
});

describe("monthly — the whole previous calendar month", () => {
  it("run on 1 Sep at 09:00 London, covers all of August", () => {
    const p = resolveReportPeriod("monthly", new Date("2026-09-01T08:00:00Z"), LONDON);
    expect(p).toEqual({
      cadence: "monthly",
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it("gets February's length right in a leap year", () => {
    const p = resolveReportPeriod("monthly", new Date("2028-03-01T09:00:00Z"), LONDON);
    expect(p).toEqual({
      cadence: "monthly",
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("rolls back across a year boundary", () => {
    const p = resolveReportPeriod("monthly", new Date("2027-01-01T09:00:00Z"), LONDON);
    expect(p).toEqual({
      cadence: "monthly",
      start: "2026-12-01",
      end: "2026-12-31",
    });
  });

  it("gets a 30-day month right", () => {
    const p = resolveReportPeriod("monthly", new Date("2026-10-01T08:00:00Z"), LONDON);
    expect(p.end).toBe("2026-09-30");
  });
});

describe("tradesInReportPeriod", () => {
  const august = resolveReportPeriod(
    "monthly",
    new Date("2026-09-01T08:00:00Z"),
    LONDON,
  );

  it("includes a trade closed inside the window", () => {
    const t = mk({ exit_time: "2026-08-15T12:00:00Z" });
    expect(tradesInReportPeriod([t], august, LONDON)).toHaveLength(1);
  });

  it("excludes one closed the day after", () => {
    const t = mk({ exit_time: "2026-09-01T12:00:00Z" });
    expect(tradesInReportPeriod([t], august, LONDON)).toHaveLength(0);
  });

  it("excludes OPEN trades", () => {
    const t = mk({ exit_time: "2026-08-15T12:00:00Z", pnl_absolute: null });
    expect(tradesInReportPeriod([t], august, LONDON)).toHaveLength(0);
  });

  it("falls back to the entry date when no close time was recorded", () => {
    const t = mk({ entry_time: "2026-08-20T12:00:00Z", exit_time: null });
    expect(tradesInReportPeriod([t], august, LONDON)).toHaveLength(1);
  });

  it("buckets a near-midnight close by the DESK's zone, not UTC", () => {
    // 23:30Z on 31 Aug is 00:30 on 1 Sep in London, so this belongs to
    // September and must NOT appear in the August report.
    const t = mk({ exit_time: "2026-08-31T23:30:00Z" });
    expect(tradesInReportPeriod([t], august, LONDON)).toHaveLength(0);
    // The same instant in UTC is still August, which is exactly the mistake a
    // server-timezone implementation would make.
    const augustUtc = resolveReportPeriod(
      "monthly",
      new Date("2026-09-01T08:00:00Z"),
      "UTC",
    );
    expect(tradesInReportPeriod([t], augustUtc, "UTC")).toHaveLength(1);
  });
});

describe("labels", () => {
  it("names a day, a range and a month readably", () => {
    expect(
      formatPeriodLabel({ cadence: "daily", start: "2026-09-01", end: "2026-09-01" }),
    ).toBe("1 Sep 2026");
    expect(
      formatPeriodLabel({ cadence: "weekly", start: "2026-08-31", end: "2026-09-04" }),
    ).toBe("31 Aug - 4 Sep 2026");
    expect(
      formatPeriodLabel({ cadence: "monthly", start: "2026-08-01", end: "2026-08-31" }),
    ).toBe("August 2026");
  });

  it("compresses a within-month week", () => {
    expect(
      formatPeriodLabel({ cadence: "weekly", start: "2026-08-24", end: "2026-08-28" }),
    ).toBe("24-28 Aug 2026");
  });
});
