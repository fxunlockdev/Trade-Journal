import { describe, expect, it } from "vitest";
import { parseTradeDate } from "@/lib/trades/trade-date";

/**
 * The first user of this is backfilling weeks of trades. Defaulting them to
 * "now" would file them all on today -- the exact wrong-day bug that started
 * the reporting feature -- so the date in the text has to be read correctly,
 * and a date that was not written must never be invented.
 */

const NOW = new Date("2026-09-03T14:00:00Z"); // a Thursday

describe("parseTradeDate", () => {
  it.each([
    ["28 aug", "2026-08-28"],
    ["28 August", "2026-08-28"],
    ["28aug", "2026-08-28"],
    ["aug 28", "2026-08-28"],
    ["August 28, 2026", "2026-08-28"],
    ["28/08", "2026-08-28"],
    ["28-08-2026", "2026-08-28"],
    ["28.08.26", "2026-08-28"],
    ["1 sep", "2026-09-01"],
  ])("reads %j as %s", (text, day) => {
    const d = parseTradeDate(`XAUUSD buy 3340 closed 3348 ${text}`, NOW);
    expect(d?.iso.slice(0, 10)).toBe(day);
  });

  it("lands at midday UTC, so the day holds in every desk timezone", () => {
    // 12:00Z is the 28th from UTC-11 to UTC+11, which covers Dubai (+4) and
    // London without this module knowing which desk the trade is for.
    expect(parseTradeDate("28 aug", NOW)?.iso).toBe("2026-08-28T12:00:00.000Z");
  });

  it("reads yesterday and today", () => {
    expect(parseTradeDate("closed yesterday", NOW)?.iso.slice(0, 10)).toBe("2026-09-02");
    expect(parseTradeDate("today", NOW)?.iso.slice(0, 10)).toBe("2026-09-03");
  });

  it("assumes last year for a month still in the future", () => {
    // Nobody backfills a trade from December that has not happened yet.
    expect(parseTradeDate("15 dec", NOW)?.iso.slice(0, 10)).toBe("2025-12-15");
  });

  it("reads numeric dates day-first", () => {
    // A European desk. 03/09 is 3 September, not 9 March.
    expect(parseTradeDate("03/09", NOW)?.iso.slice(0, 10)).toBe("2026-09-03");
  });

  it("returns null when no date is written", () => {
    // Null means "use now", and that decision belongs to the caller.
    expect(parseTradeDate("XAUUSD buy 3340 sl 3335 closed 3348", NOW)).toBeNull();
  });

  it("rejects an impossible date rather than rolling it over", () => {
    // Date.UTC(2026, 1, 31) silently becomes 3 March.
    expect(parseTradeDate("31 feb", NOW)).toBeNull();
    expect(parseTradeDate("32/08", NOW)).toBeNull();
  });

  it("does not mistake a price for a date", () => {
    // "1.0850" contains digits and dots; it must not become 1 August.
    expect(parseTradeDate("EURUSD sell 1.0850 closed 1.0820", NOW)).toBeNull();
  });
});
