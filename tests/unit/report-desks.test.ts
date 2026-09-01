import { describe, expect, it } from "vitest";
import {
  deskJournals,
  findDeskForJournals,
  orderDesks,
  posterIdentity,
  type ReportDesk,
} from "@/lib/reports/desks";
import {
  groupStorageKey,
  GROUP_NAME_MAX,
  journalSetKey,
} from "@/lib/posters/scope";
import {
  createDeskSchema,
  isValidTimeZone,
  updateDeskSchema,
} from "@/lib/validators/desk";

/**
 * A desk decides what a published poster calls itself. Getting the match wrong
 * does not error — it silently publishes an unbranded or wrongly branded image,
 * so these pin the matching rules rather than the plumbing.
 */

const SCALP = "0d6f1a2e-4c8b-4f21-9c3a-5e7b8d901111";
const CHRIS = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b2222";
const YOHAN = "9f8e7d6c-5b4a-4392-a1b0-c9d8e7f63333";
const FOREX = "5c4b3a29-1807-4655-b4c3-d2e1f0a94444";

const desk = (o: Partial<ReportDesk> = {}): ReportDesk => ({
  id: "d1",
  owner_user_id: "u1",
  name: "Gold Intraday",
  logo_path: null,
  journal_ids: [CHRIS, YOHAN],
  timezone: "Europe/London",
  theme_id: "obsidian-gold",
  template_ids: ["design-a", "design-b", "design-c"],
  sort_order: 0,
  is_active: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...o,
});

const JOURNALS = [
  { id: SCALP, name: "TTC GOLD | SCALP" },
  { id: CHRIS, name: "TTC GOLD | CHRIS" },
  { id: YOHAN, name: "TTC GOLD | YOHAN" },
  { id: FOREX, name: "TTC FOREX" },
];

describe("findDeskForJournals — matches a SET, not an order", () => {
  it("finds a desk however the journals were ticked", () => {
    const d = desk();
    expect(findDeskForJournals([d], [CHRIS, YOHAN])?.name).toBe("Gold Intraday");
    expect(findDeskForJournals([d], [YOHAN, CHRIS])?.name).toBe("Gold Intraday");
  });

  it("does not match a SUBSET or a SUPERSET", () => {
    // Publishing Chris alone under the two-trader desk's name would claim
    // Yohan's results were included when they were not.
    const d = desk();
    expect(findDeskForJournals([d], [CHRIS])).toBeNull();
    expect(findDeskForJournals([d], [CHRIS, YOHAN, FOREX])).toBeNull();
  });

  it("ignores inactive desks so archiving stops branding without deleting", () => {
    const d = desk({ is_active: false });
    expect(findDeskForJournals([d], [CHRIS, YOHAN])).toBeNull();
  });

  it("returns null for an empty selection rather than any desk", () => {
    expect(findDeskForJournals([desk()], [])).toBeNull();
  });

  it("picks the single-journal desk, not a combination containing it", () => {
    const combined = desk({ id: "d1", journal_ids: [CHRIS, YOHAN] });
    const solo = desk({ id: "d2", name: "Chris Only", journal_ids: [CHRIS] });
    expect(findDeskForJournals([combined, solo], [CHRIS])?.name).toBe("Chris Only");
  });
});

describe("posterIdentity — a saved name beats a derived one", () => {
  it("uses the desk's name and logo when one matches", () => {
    const d = desk({ logo_path: "u1/gold.png" });
    const id = posterIdentity([d], [CHRIS, YOHAN], JOURNALS);
    expect(id).toEqual({
      name: "Gold Intraday",
      logoPath: "u1/gold.png",
      fromDesk: true,
    });
  });

  it("falls back to the derived name for an ad-hoc selection", () => {
    // This is the failure the desk model exists to fix: two journals joined by
    // their own names is accurate and unusable as marketing.
    const id = posterIdentity([], [CHRIS, YOHAN], JOURNALS);
    expect(id.fromDesk).toBe(false);
    expect(id.logoPath).toBeNull();
    expect(id.name).toBe("TTC GOLD | CHRIS + TTC GOLD | YOHAN");
  });

  it("derives a single journal's own name, as before", () => {
    expect(posterIdentity([], [FOREX], JOURNALS).name).toBe("TTC FOREX");
  });

  it("gives an empty selection an empty name rather than throwing", () => {
    expect(posterIdentity([], [], JOURNALS).name).toBe("");
  });
});

describe("deskJournals", () => {
  it("resolves ids in the caller's journal order", () => {
    expect(deskJournals(desk(), JOURNALS).map((j) => j.name)).toEqual([
      "TTC GOLD | CHRIS",
      "TTC GOLD | YOHAN",
    ]);
  });

  it("drops an id that no longer resolves instead of throwing", () => {
    // A journal can be deleted while a desk still lists it. Publishing the
    // remaining journal beats failing the whole desk's report.
    const d = desk({ journal_ids: [CHRIS, "deleted-id"] });
    expect(deskJournals(d, JOURNALS).map((j) => j.id)).toEqual([CHRIS]);
  });
});

describe("orderDesks", () => {
  it("sorts by sort_order, then name, without mutating the input", () => {
    const input = [
      desk({ id: "a", name: "Zulu", sort_order: 1 }),
      desk({ id: "b", name: "Alpha", sort_order: 1 }),
      desk({ id: "c", name: "Middle", sort_order: 0 }),
    ];
    expect(orderDesks(input).map((d) => d.name)).toEqual([
      "Middle",
      "Alpha",
      "Zulu",
    ]);
    expect(input.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});

describe("journalSetKey — the one definition of 'the same combination'", () => {
  it("is order-independent", () => {
    expect(journalSetKey([CHRIS, YOHAN])).toBe(journalSetKey([YOHAN, CHRIS]));
  });

  it("is null for an empty set", () => {
    expect(journalSetKey([])).toBeNull();
  });

  // Desks and the browser's storage keys must agree on identity, or a desk
  // stops matching the selection that created it and the poster silently loses
  // its name. Asserted against the real key builder, not a copy of its output.
  it("is the suffix the poster storage keys are built from", () => {
    const key = groupStorageKey([YOHAN, CHRIS]);
    expect(key).toBe(`trdr_poster_group:${journalSetKey([CHRIS, YOHAN])}`);
  });
});

describe("desk validation", () => {
  it("accepts real IANA zones and rejects plausible non-zones", () => {
    for (const tz of ["Europe/London", "UTC", "America/New_York", "Asia/Tokyo"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
    // A desk's zone decides what "yesterday" means for its report. An
    // unresolvable string would not fail loudly, it would publish the wrong
    // day, so these must be refused at the boundary.
    for (const tz of ["GMT+1", "London", "Europe/Atlantis", ""]) {
      expect(isValidTimeZone(tz), tz).toBe(false);
    }
    // These are the dangerous ones. Intl ACCEPTS them, silently resolving
    // "BST" to Asia/Dhaka and "EST" to America/Panama, so a plain
    // accepts-without-throwing check lets a desk report six hours out of
    // position and never says a word.
    for (const alias of ["BST", "EST", "Zulu"]) {
      expect(
        () => new Intl.DateTimeFormat("en-GB", { timeZone: alias }),
      ).not.toThrow();
      expect(isValidTimeZone(alias), alias).toBe(false);
    }
  });

  it("sorts and de-duplicates journal ids", () => {
    // Order carries no meaning, and a duplicate would double-count that
    // journal's trades in the desk's own report.
    const parsed = createDeskSchema.parse({
      name: "Gold Intraday",
      journal_ids: [YOHAN, CHRIS, YOHAN],
    });
    expect(parsed.journal_ids).toEqual([CHRIS, YOHAN].sort());
  });

  it("defaults the timezone to London rather than the server's zone", () => {
    const parsed = createDeskSchema.parse({ name: "Forex", journal_ids: [FOREX] });
    expect(parsed.timezone).toBe("Europe/London");
  });

  it("refuses a name longer than the poster header can show", () => {
    // 40 is GROUP_NAME_MAX — past it the name overruns the 1080px canvas
    // rather than wrapping.
    const ok = createDeskSchema.safeParse({
      name: "x".repeat(GROUP_NAME_MAX),
      journal_ids: [FOREX],
    });
    const tooLong = createDeskSchema.safeParse({
      name: "x".repeat(GROUP_NAME_MAX + 1),
      journal_ids: [FOREX],
    });
    expect(ok.success).toBe(true);
    expect(tooLong.success).toBe(false);
  });

  it("refuses a desk with no journals", () => {
    expect(
      createDeskSchema.safeParse({ name: "Empty", journal_ids: [] }).success,
    ).toBe(false);
  });

  it("trims a name so whitespace cannot pass the minimum", () => {
    expect(
      createDeskSchema.safeParse({ name: "   ", journal_ids: [FOREX] }).success,
    ).toBe(false);
  });

  it("update schema allows a single field without demanding the rest", () => {
    const parsed = updateDeskSchema.safeParse({ is_active: false });
    expect(parsed.success).toBe(true);
  });
});
