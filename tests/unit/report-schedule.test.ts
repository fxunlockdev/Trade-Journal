import { describe, expect, it } from "vitest";
import {
  dueCadences,
  isCadenceDue,
  periodsToConsider,
  SCHEDULE,
} from "@/lib/reports/schedule";
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

  it("recovers a dropped tick within the window", () => {
    // 06:00 BST is 05:00Z; 06:30Z is 07:30 local, still inside the two-hour
    // window, so a tick dropped at 06:00 is picked up.
    expect(dueCadences(at("2026-07-15T06:30:00Z"), LONDON)).toContain("daily");
  });

  it("STOPS being due once the window closes", () => {
    // The bug this closes: "due" used to mean any time from 06:00 to midnight,
    // which is how marketing images reached a partner channel at 14:31 with
    // nothing scheduled for then. Daily at 06:00 has to mean 06:00.
    expect(dueCadences(at("2026-07-15T20:00:00Z"), LONDON)).not.toContain("daily");
    expect(dueCadences(at("2026-07-15T13:00:00Z"), LONDON)).not.toContain("daily");
  });

  it("closes the window on the hour boundary, not after it", () => {
    // 07:00Z in July is 08:00 local = 06:00 + 2, the first hour outside.
    expect(dueCadences(at("2026-07-15T07:00:00Z"), LONDON)).not.toContain("daily");
    expect(dueCadences(at("2026-07-15T06:59:00Z"), LONDON)).toContain("daily");
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

describe("periodsToConsider (backfill)", () => {
  it("returns yesterday last, oldest first", () => {
    // Order is the point: a desk five days behind should publish the 28th,
    // then the 29th, then the 30th, so the group reads in the order things
    // happened rather than backwards.
    const p = periodsToConsider("daily", at("2026-09-02T07:00:00Z"), LONDON);
    expect(p[p.length - 1].start).toBe("2026-09-01");
    expect(p[0].start).toBe("2026-08-25");
    const starts = p.map((x) => x.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("covers a week of daily reports, so a batch import is not lost", () => {
    // The whole reason this exists: journals are filled from broker PDFs days
    // late, so the single-chance daily run found nothing and never returned.
    const p = periodsToConsider("daily", at("2026-09-02T07:00:00Z"), LONDON);
    expect(p).toHaveLength(8);
    expect(p.map((x) => x.start)).toContain("2026-08-28");
  });

  it("still includes yesterday, so normal running is unchanged", () => {
    const p = periodsToConsider("daily", at("2026-09-02T07:00:00Z"), LONDON);
    const normal = p[p.length - 1];
    expect(normal.start).toBe("2026-09-01");
    expect(normal.end).toBe("2026-09-01");
  });

  it("dedupes weekly periods rather than repeating one week", () => {
    // Shifting the instant lands inside the same week repeatedly; without the
    // dedupe the same period would be considered several times per tick.
    const p = periodsToConsider("weekly", at("2026-09-05T07:00:00Z"), LONDON);
    const keys = p.map((x) => `${x.start}:${x.end}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns whole previous months for monthly, deduped", () => {
    const p = periodsToConsider("monthly", at("2026-09-02T09:00:00Z"), LONDON);
    const keys = p.map((x) => `${x.start}:${x.end}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(p[p.length - 1].start).toBe("2026-08-01");
    expect(p[p.length - 1].end).toBe("2026-08-31");
  });

  it("is bounded, so a first deploy cannot republish all history", () => {
    for (const c of ["daily", "weekly", "monthly"] as const) {
      expect(periodsToConsider(c, at("2026-09-02T09:00:00Z"), LONDON).length)
        .toBeLessThanOrEqual(8);
    }
  });
});

describe("periodsToConsider — the `since` floor", () => {
  const now = at("2026-09-02T07:00:00Z");

  it("publishes nothing historical for a setup created today", () => {
    // THE bug: a new setup has no delivery record for any past period, so
    // every day in the lookback read as "never published" and the backfill
    // sent the lot. Three setups made within forty minutes put eleven albums
    // into a partner channel, going back to before they existed.
    const p = periodsToConsider("daily", now, LONDON, at("2026-09-02T12:57:00Z"));
    expect(p.every((x) => x.end >= "2026-09-02")).toBe(true);
  });

  it("still rescues a day missed by an older setup", () => {
    // The whole point of backfill: a setup running since 25 Aug that never
    // published the 28th (its trades were imported late) must still get it.
    const p = periodsToConsider("daily", now, LONDON, at("2026-08-25T09:00:00Z"));
    expect(p.map((x) => x.start)).toContain("2026-08-28");
  });

  it("keeps yesterday for a setup created yesterday", () => {
    // The ordinary next-morning run must not be suppressed by its own floor.
    const p = periodsToConsider("daily", now, LONDON, at("2026-09-01T08:00:00Z"));
    expect(p.map((x) => x.start)).toContain("2026-09-01");
  });

  it("suppresses last month's report for a setup created this month", () => {
    // August ended before the setup existed. Publishing it is a deliberate
    // choice through the button, not something that happens unattended.
    const p = periodsToConsider("monthly", now, LONDON, at("2026-09-02T12:57:00Z"));
    expect(p.map((x) => x.start)).not.toContain("2026-08-01");
  });

  it("is unchanged when no floor is given", () => {
    expect(periodsToConsider("daily", now, LONDON)).toHaveLength(8);
  });

  it("compares local dates, not instants", () => {
    // 23:30Z on 1 Sept is already 00:30 on 2 Sept in London, so a setup made
    // then has a floor of the 2nd and must not publish the 1st.
    const p = periodsToConsider("daily", now, LONDON, at("2026-09-01T23:30:00Z"));
    expect(p.map((x) => x.start)).not.toContain("2026-09-01");
  });
});


describe("the publishing window", () => {
  it("gives monthly its own window at 09:00, not the daily one", () => {
    // On the 1st both cadences exist; they must not bleed into each other.
    const sixAm = dueCadences(at("2026-02-01T06:00:00Z"), LONDON);
    expect(sixAm).toContain("daily");
    expect(sixAm).not.toContain("monthly");

    const nineAm = dueCadences(at("2026-02-01T09:00:00Z"), LONDON);
    expect(nineAm).toContain("monthly");
    // 09:00 is past 06:00 + 2, so the daily window has already closed.
    expect(nineAm).not.toContain("daily");
  });

  it("closes the weekly window too", () => {
    // 2026-01-17 is a Saturday.
    expect(dueCadences(at("2026-01-17T06:30:00Z"), LONDON)).toContain("weekly");
    expect(dueCadences(at("2026-01-17T15:00:00Z"), LONDON)).not.toContain("weekly");
  });

  it("means an all-day outage waits for tomorrow rather than posting at night", () => {
    // The safe failure: a late report is a nuisance, an unexpected one in a
    // partner channel is not.
    expect(dueCadences(at("2026-07-15T22:00:00Z"), LONDON)).toEqual([]);
  });
});
