import { describe, expect, it } from "vitest";
import { buildSnapshot, snapshotKey, tradesForDesk } from "@/lib/reports/snapshot";
import { resolveReportPeriod } from "@/lib/reports/periods-tz";
import type { ReportDesk, Trade } from "@/types/database";

/**
 * A snapshot is the frozen set of numbers three poster styles all render from.
 * If it is wrong, three images are wrong and identical, and they get published.
 */

const CHRIS = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b2222";
const YOHAN = "9f8e7d6c-5b4a-4392-a1b0-c9d8e7f63333";
const FOREX = "5c4b3a29-1807-4655-b4c3-d2e1f0a94444";

const desk = (o: Partial<ReportDesk> = {}): ReportDesk => ({
  id: "desk-1",
  owner_user_id: "owner-1",
  name: "Gold Intraday",
  logo_path: null,
  journal_ids: [CHRIS, YOHAN],
  timezone: "Europe/London",
  sort_order: 0,
  is_active: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...o,
});

let seq = 0;
const mk = (o: Partial<Trade> = {}): Trade =>
  ({
    id: `t${seq++}`,
    journal_id: CHRIS,
    instrument: "XAUUSD",
    direction: "buy",
    entry_price: 2400,
    stop_loss: 2395,
    pnl_absolute: 100,
    pnl_currency: "USD",
    r_multiple: 1,
    entry_time: "2026-08-31T12:00:00Z",
    exit_time: "2026-08-31T12:00:00Z",
    ...o,
  }) as unknown as Trade;

/** 1 Sep 2026, 06:00 London (05:00 UTC, BST). */
const AT_6AM = new Date("2026-09-01T05:00:00Z");

describe("tradesForDesk — scoped by the desk's OWN journals", () => {
  const period = resolveReportPeriod("daily", AT_6AM, "Europe/London");

  it("includes every journal the desk names", () => {
    const trades = [mk({ journal_id: CHRIS }), mk({ journal_id: YOHAN })];
    expect(tradesForDesk(desk(), trades, period)).toHaveLength(2);
  });

  it("excludes a journal the desk does not name", () => {
    // The combined Gold desk must never pick up Forex's trades, however the
    // caller assembled the array it passed in.
    const trades = [mk({ journal_id: CHRIS }), mk({ journal_id: FOREX })];
    expect(tradesForDesk(desk(), trades, period)).toHaveLength(1);
  });

  it("excludes trades outside the period", () => {
    const trades = [
      mk({ exit_time: "2026-08-31T12:00:00Z" }),
      mk({ exit_time: "2026-08-29T12:00:00Z" }),
    ];
    expect(tradesForDesk(desk(), trades, period)).toHaveLength(1);
  });
});

describe("buildSnapshot", () => {
  it("freezes the period, the zone and the numbers together", () => {
    const s = buildSnapshot(desk(), "daily", [mk(), mk({ pnl_absolute: -40 })], AT_6AM);
    expect(s.period_start).toBe("2026-08-31");
    expect(s.period_end).toBe("2026-08-31");
    expect(s.timezone).toBe("Europe/London");
    expect(s.trade_count).toBe(2);
    expect(s.metrics.netPnl).toBe(60);
    expect(s.status).toBe("pending");
  });

  it("marks an empty period SKIPPED rather than publishing a zero poster", () => {
    // "0 trades, 0% win rate" into a partner group reads as a bad day rather
    // than a day off, and would arrive every weekend and bank holiday.
    const s = buildSnapshot(desk(), "daily", [], AT_6AM);
    expect(s.status).toBe("skipped");
    expect(s.trade_count).toBe(0);
  });

  it("still claims the period when skipping, so the scheduler stops asking", () => {
    // The row is written either way; the key is what stops 96 reconsiderations
    // a day of the same empty Sunday.
    const s = buildSnapshot(desk(), "daily", [], AT_6AM);
    expect(snapshotKey(s)).toBe("desk-1:daily:2026-08-31:2026-08-31");
  });

  it("is deterministic: same inputs, same snapshot", () => {
    const trades = [mk(), mk({ pnl_absolute: -40 })];
    const a = buildSnapshot(desk(), "daily", trades, AT_6AM);
    const b = buildSnapshot(desk(), "daily", trades, AT_6AM);
    expect(a).toEqual(b);
  });

  it("resolves the period in the DESK's zone, not the server's", () => {
    // Same instant, same nominal period, but the BOUNDARY sits elsewhere.
    // 22:00Z on 31 Aug is 23:00 that evening in London (BST) — inside the
    // 31 Aug report — and 07:00 the NEXT morning in Tokyo, outside it. A
    // scheduler resolving periods in the server's zone would put this trade in
    // the same report for both desks, and be wrong for one of them.
    const lateTrade = mk({ exit_time: "2026-08-31T22:00:00Z" });
    const london = buildSnapshot(desk(), "daily", [lateTrade], AT_6AM);
    const tokyo = buildSnapshot(
      desk({ timezone: "Asia/Tokyo" }),
      "daily",
      [lateTrade],
      AT_6AM,
    );
    expect(london.trade_count).toBe(1);
    expect(tokyo.trade_count).toBe(0);
  });

  it("carries the weekly period as Monday to Friday", () => {
    // Saturday 5 Sep 2026, 06:00 London.
    const s = buildSnapshot(
      desk(),
      "weekly",
      [],
      new Date("2026-09-05T05:00:00Z"),
    );
    expect(s.period_start).toBe("2026-08-31");
    expect(s.period_end).toBe("2026-09-04");
  });

  it("carries the monthly period as the whole previous month", () => {
    // 1 Sep 2026, 09:00 London.
    const s = buildSnapshot(
      desk(),
      "monthly",
      [],
      new Date("2026-09-01T08:00:00Z"),
    );
    expect(s.period_start).toBe("2026-08-01");
    expect(s.period_end).toBe("2026-08-31");
  });
});

describe("snapshotKey — mirrors the database's unique index", () => {
  it("differs by cadence for the same desk and day", () => {
    const daily = buildSnapshot(desk(), "daily", [], AT_6AM);
    const weekly = buildSnapshot(desk(), "weekly", [], AT_6AM);
    expect(snapshotKey(daily)).not.toBe(snapshotKey(weekly));
  });

  it("differs by desk for the same period", () => {
    const a = buildSnapshot(desk({ id: "desk-1" }), "daily", [], AT_6AM);
    const b = buildSnapshot(desk({ id: "desk-2" }), "daily", [], AT_6AM);
    expect(snapshotKey(a)).not.toBe(snapshotKey(b));
  });

  it("is identical across runs on the same day, which is the point", () => {
    const morning = buildSnapshot(desk(), "daily", [], new Date("2026-09-01T05:00:00Z"));
    const later = buildSnapshot(desk(), "daily", [], new Date("2026-09-01T11:45:00Z"));
    expect(snapshotKey(morning)).toBe(snapshotKey(later));
  });
});
