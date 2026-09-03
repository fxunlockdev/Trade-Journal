import { describe, expect, it } from "vitest";
import { parseTradeDate } from "@/lib/trades/trade-date";

/**
 * The first user of this is backfilling weeks of trades. Defaulting them to
 * "now" would file them all on today -- the exact wrong-day bug that started
 * the reporting feature -- so the date in the text has to be read correctly,
 * and a date that was not written must never be invented.
 *
 * The adversarial pass found that prices were being read as dates and real
 * dates were being dropped. Every case it produced is pinned below.
 */

const NOW = new Date("2026-09-03T14:00:00Z"); // a Thursday

function day(text: string): string | null {
  const r = parseTradeDate(text, NOW);
  return r?.kind === "date" ? r.iso.slice(0, 10) : null;
}

describe("dates that were written", () => {
  it.each([
    ["28 aug", "2026-08-28"],
    ["28 August", "2026-08-28"],
    ["28aug", "2026-08-28"],
    ["aug 28", "2026-08-28"],
    ["August 28, 2026", "2026-08-28"],
    ["on 28/08", "2026-08-28"],
    ["28/08", "2026-08-28"],
    ["28-08-2026", "2026-08-28"],
    ["on 28.08.26", "2026-08-28"],
    ["on 28.08", "2026-08-28"],
    ["1 sep", "2026-09-01"],
    ["the 28th", "2026-08-28"],
    ["on the 2nd", "2026-09-02"],
  ])("reads %j as %s", (text, expected) => {
    expect(day(`XAUUSD buy 3340 closed 3348 ${text}`)).toBe(expected);
  });

  it("lands a written day at midday UTC, so the day holds from UTC-11 to UTC+11", () => {
    const r = parseTradeDate("28 aug", NOW);
    expect(r?.kind === "date" && r.iso).toBe("2026-08-28T12:00:00.000Z");
  });

  it("keeps the words 'today' and 'yesterday' as the moment typed, not a UTC day", () => {
    // 22:00Z on the 2nd is already the 3rd in Dubai. An instant is right in
    // every zone; a midday-UTC calendar day is not.
    const late = new Date("2026-09-02T22:00:00Z");
    const today = parseTradeDate("closed 3348 today", late);
    const yesterday = parseTradeDate("closed 3348 yesterday", late);
    expect(today?.kind === "date" && today.iso).toBe(late.toISOString());
    expect(yesterday?.kind === "date" && yesterday.iso).toBe(
      new Date(late.getTime() - 24 * 3600 * 1000).toISOString(),
    );
    expect(today?.kind === "date" && today.label).toBe("today");
    expect(yesterday?.kind === "date" && yesterday.label).toBe("yesterday");
  });

  it("assumes last year for a month well in the future", () => {
    // Nobody backfills a trade from December that has not happened yet.
    expect(day("15 dec")).toBe("2025-12-15");
  });

  it("calls a date a few days ahead a typo rather than filing it last year", () => {
    // 05/09 typed on 03/09 is far more likely a slip than a trade from 2025.
    const r = parseTradeDate("closed 3348 on 05/09", NOW);
    expect(r?.kind).toBe("future");
  });

  it("reads numeric dates day-first", () => {
    // A European desk. 03/09 is 3 September, not 9 March.
    expect(day("03/09")).toBe("2026-09-03");
  });

  it("keeps looking when an earlier number is not a date", () => {
    // 12.50 is a price; the real date comes after it.
    expect(day("USOIL buy 12.50 closed 13.50 on 28/08")).toBe("2026-08-28");
    expect(day("XAGUSD buy 38.55 sl 38.20 closed 38.90 28/08")).toBe("2026-08-28");
  });
});

describe("dates that were NOT written", () => {
  it("returns null when no date is present", () => {
    // Null means "use now", and that decision belongs to the caller.
    expect(parseTradeDate("XAUUSD buy 3340 sl 3335 closed 3348", NOW)).toBeNull();
  });

  it("rejects an impossible date rather than rolling it over", () => {
    // Date.UTC(2026, 1, 31) silently becomes 3 March.
    expect(parseTradeDate("31 feb", NOW)).toBeNull();
    expect(parseTradeDate("32/08", NOW)).toBeNull();
  });

  it.each([
    "EURUSD sell 1.0850 closed 1.0820",
    "EURUSD buy 1.09 sl 1.08 closed 1.10",
    "XAUUSD buy 3340 closed 3348 1.5 lots",
    "XAUUSD buy 3340 closed 3348 risk 1.2%",
    "NATGAS buy 3.12 sl 3.05 closed 3.20",
    "USOIL buy 28.08 sl 27.90 closed 28.40",
    "tp 5-10 pips",
    "XAUUSD buy 3335-3330 closed 3348",
  ])("does not mistake a price, size or range for a date: %j", (text) => {
    expect(parseTradeDate(text, NOW)).toBeNull();
  });
});
