import { describe, expect, it } from "vitest";
import { dueCadences, isCadenceDue, SCHEDULE } from "@/lib/reports/schedule";
import { zonedNow } from "@/lib/reports/periods-tz";

/**
 * The scheduler decides when images appear in front of partners. The cases that
 * matter are the ones a fixed UTC cron gets wrong: British Summer Time, and the
 * 1st of a month when two cadences come due at once.
 */

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("daily", () => {
  it("is not due before 06:00 local", () => {
    // 05:30 UTC in January is 05:30 in London.
    expect(dueCadences(at("2026-01-15T05:30:00Z"), LONDON)).not.toContain("daily");
  });

  it("is due at 06:00 local in winter (UTC+0)", () => {
    expect(dueCadences(at("2026-01-15T06:00:00Z"), LONDON)).toContain("daily");
  });

  it("is due at 06:00 local in summer, which is 05:00 UTC", () => {
    // THE case a fixed UTC cron gets wrong. During BST, 05:00 UTC IS 06:00 in
    // London, so a 06:00-UTC trigger would publish an hour late all summer.
    expect(dueCadences(at("2026-07-15T05:00:00Z"), LONDON)).toContain("daily");
  });

  it("is NOT due at 04:59 UTC in summer, which is 05:59 local", () => {
    expect(dueCadences(at("2026-07-15T04:59:00Z"), LONDON)).not.toContain("daily");
  });

  it("stays due for the rest of the day, so a missed tick still recovers", () => {
    // A single trigger that gets dropped means no report and nobody notices.
    expect(dueCadences(at("2026-07-15T20:00:00Z"), LONDON)).toContain("daily");
  });
});

describe("weekly", () => {
  it("is due on Saturday at 06:00 local", () => {
    // 2026-01-17 is a Saturday.
    const due = dueCadences(at("2026-01-17T06:00:00Z"), LONDON);
    expect(due).toContain("weekly");
  });

  it("is not due on Friday", () => {
    expect(dueCadences(at("2026-01-16T06:00:00Z"), LONDON)).not.toContain("weekly");
  });

  it("is not due on Sunday", () => {
    expect(dueCadences(at("2026-01-18T06:00:00Z"), LONDON)).not.toContain("weekly");
  });

  it("is not due early on Saturday", () => {
    expect(dueCadences(at("2026-01-17T05:00:00Z"), LONDON)).not.toContain("weekly");
  });
});

describe("monthly", () => {
  it("is due on the 1st at 09:00 local", () => {
    expect(dueCadences(at("2026-02-01T09:00:00Z"), LONDON)).toContain("monthly");
  });

  it("is not due on the 1st at 06:00, when the daily already is", () => {
    // The three-hour gap is the point: on the 1st both come due, and sharing an
    // hour would drop 24 images into the group at once.
    const due = dueCadences(at("2026-02-01T06:00:00Z"), LONDON);
    expect(due).toContain("daily");
    expect(due).not.toContain("monthly");
  });

  it("is not due on the 2nd", () => {
    expect(dueCadences(at("2026-02-02T09:00:00Z"), LONDON)).not.toContain("monthly");
  });
});

describe("timezone independence", () => {
  it("uses the DESK's zone, not the server's", () => {
    // 20:00 UTC is 06:00 the next morning in Auckland. A desk there is due;
    // a London desk is not yet on that calendar day at that hour.
    const instant = at("2026-01-14T17:00:00Z");
    expect(dueCadences(instant, "Pacific/Auckland")).toContain("daily");
    expect(zonedNow(instant, "Pacific/Auckland").hour).toBe(6);
  });
});

describe("isCadenceDue", () => {
  it("matches on the hour boundary, not after it", () => {
    const daily = SCHEDULE.find((s) => s.cadence === "daily")!;
    const local = { year: 2026, month: 1, day: 15, hour: 6, weekday: 4 };
    expect(isCadenceDue(daily, local)).toBe(true);
    expect(isCadenceDue(daily, { ...local, hour: 5 })).toBe(false);
  });
});
