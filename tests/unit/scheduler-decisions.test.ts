import { describe, expect, it } from "vitest";
import { dueCadences, periodsToConsider } from "@/lib/reports/schedule";
import type { Cadence } from "@/lib/reports/periods-tz";

/**
 * What the scheduler would actually publish, composed end to end.
 *
 * The unit tests elsewhere check each rule alone. Both bugs that reached the
 * partner channel today lived in the COMBINATION: each rule was right and the
 * set they produced together was wrong. So this file asks the only question
 * that matters operationally, "given this clock and this setup, what goes
 * out?", and pins the two incidents as regressions.
 */

const DUBAI = "Asia/Dubai";
const at = (iso: string) => new Date(iso);

/**
 * Every period the scheduler would consider right now, flattened across
 * cadences. Mirrors the cron's own loop: which cadences are in their window,
 * then which periods each may still publish.
 */
function wouldConsider(
  now: Date,
  timeZone: string,
  since?: Date,
): { cadence: Cadence; start: string; end: string }[] {
  return dueCadences(now, timeZone).flatMap((cadence) =>
    periodsToConsider(cadence, now, timeZone, since).map((p) => ({
      cadence,
      start: p.start,
      end: p.end,
    })),
  );
}

describe("regression: the day a new setup published a week of history", () => {
  // Three setups were created within forty minutes on 2 September. Each had no
  // delivery record for any past period, so every day in the lookback read as
  // "never published" and the backfill sent the lot: eleven albums,
  // thirty-three images, into a channel shared with partners.
  const created = at("2026-09-02T12:57:00Z");
  const nextMorning = at("2026-09-03T02:30:00Z"); // 06:30 Dubai

  it("considers nothing from before the setup existed", () => {
    const considered = wouldConsider(nextMorning, DUBAI, created);
    const floor = "2026-09-02";
    expect(considered.every((p) => p.end >= floor)).toBe(true);
  });

  it("would have published a week of days without the floor", () => {
    // The bug, pinned. Without `since` the same clock offers days from August.
    const unbounded = wouldConsider(nextMorning, DUBAI);
    expect(unbounded.some((p) => p.start < "2026-09-01")).toBe(true);
  });

  it("offers at most one day to publish the morning after setup", () => {
    const considered = wouldConsider(nextMorning, DUBAI, created).filter(
      (p) => p.cadence === "daily",
    );
    expect(considered).toHaveLength(1);
    expect(considered[0].start).toBe("2026-09-02");
  });
});

describe("regression: the afternoon posters arrived unscheduled", () => {
  // Albums landed at 14:01, 14:16 and 14:31 because a cadence counted as due
  // from its trigger hour until midnight.
  it("publishes nothing in the afternoon", () => {
    // 10:31 UTC is 14:31 Dubai, the exact hour of the incident.
    expect(wouldConsider(at("2026-09-02T10:31:00Z"), DUBAI)).toEqual([]);
  });

  it("publishes nothing late at night", () => {
    expect(wouldConsider(at("2026-09-02T18:00:00Z"), DUBAI)).toEqual([]);
  });

  it("publishes in the morning window", () => {
    // 02:00 UTC is 06:00 Dubai.
    expect(wouldConsider(at("2026-09-03T02:00:00Z"), DUBAI).length).toBeGreaterThan(0);
  });
});

describe("the live configuration, as it actually stands", () => {
  // Setups created 2 Sep, Asia/Dubai, publishing to the marketing channel.
  const created = at("2026-09-02T12:57:00Z");

  it("offers only 2 September on the morning of the 3rd", () => {
    const daily = wouldConsider(at("2026-09-03T02:00:00Z"), DUBAI, created)
      .filter((p) => p.cadence === "daily");
    expect(daily.map((p) => p.start)).toEqual(["2026-09-02"]);
  });

  it("offers Monday to Friday on Saturday morning", () => {
    // 2026-09-05 is a Saturday. 02:00Z is 06:00 Dubai.
    const weekly = wouldConsider(at("2026-09-05T02:00:00Z"), DUBAI, created)
      .filter((p) => p.cadence === "weekly");
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly[weekly.length - 1]).toMatchObject({
      start: "2026-08-31",
      end: "2026-09-04",
    });
  });

  it("does not offer the weekly on a weekday", () => {
    const weekly = wouldConsider(at("2026-09-03T02:00:00Z"), DUBAI, created)
      .filter((p) => p.cadence === "weekly");
    expect(weekly).toEqual([]);
  });

  it("offers September's month on 1 October, and not before", () => {
    const onTheFirst = wouldConsider(at("2026-10-01T05:00:00Z"), DUBAI, created)
      .filter((p) => p.cadence === "monthly");
    expect(onTheFirst.map((p) => p.start)).toContain("2026-09-01");

    const onTheSecond = wouldConsider(at("2026-10-02T05:00:00Z"), DUBAI, created)
      .filter((p) => p.cadence === "monthly");
    expect(onTheSecond).toEqual([]);
  });

  it("keeps the daily and monthly apart on the 1st", () => {
    // Both come due that morning. At 06:00 Dubai only the daily is in window;
    // at 09:00 only the monthly. Twelve images, then twelve, not twenty-four.
    const six = wouldConsider(at("2026-10-01T02:00:00Z"), DUBAI, created);
    expect(six.map((p) => p.cadence)).toContain("daily");
    expect(six.map((p) => p.cadence)).not.toContain("monthly");

    const nine = wouldConsider(at("2026-10-01T05:00:00Z"), DUBAI, created);
    expect(nine.map((p) => p.cadence)).toContain("monthly");
    expect(nine.map((p) => p.cadence)).not.toContain("daily");
  });
});

describe("Dubai has no daylight saving, unlike London", () => {
  const created = at("2026-01-01T00:00:00Z");

  it("fires at the same UTC hour in summer and winter", () => {
    // 02:00Z is 06:00 Dubai in both, so the schedule cannot drift.
    expect(dueCadences(at("2026-01-15T02:00:00Z"), DUBAI)).toContain("daily");
    expect(dueCadences(at("2026-07-15T02:00:00Z"), DUBAI)).toContain("daily");
  });

  it("would have drifted an hour on London, which is why this moved", () => {
    // 05:00Z is 06:00 London in summer but 05:00 in winter.
    expect(dueCadences(at("2026-07-15T05:00:00Z"), "Europe/London")).toContain("daily");
    expect(dueCadences(at("2026-01-15T05:00:00Z"), "Europe/London")).not.toContain("daily");
    expect(wouldConsider(at("2026-01-15T02:00:00Z"), DUBAI, created).length).toBeGreaterThan(0);
  });
});
