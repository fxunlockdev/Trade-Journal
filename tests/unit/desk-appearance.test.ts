import { describe, expect, it } from "vitest";
import { createDeskSchema, updateDeskSchema } from "@/lib/validators/desk";
import { POSTER_TEMPLATES } from "@/lib/posters/templates";

/**
 * Appearance decides what a partner actually sees. These pin the cases where a
 * plausible value would publish the wrong thing, or nothing at all.
 */

const base = {
  name: "Gold Intraday",
  journal_ids: ["11111111-2222-4333-8444-555555555555"],
};

describe("theme_id", () => {
  it("accepts a real theme", () => {
    const r = createDeskSchema.safeParse({ ...base, theme_id: "blue-violet" });
    expect(r.success).toBe(true);
  });

  it("refuses an unknown theme rather than storing it", () => {
    // The renderer falls back for an unknown id, so this would not crash: it
    // would quietly publish a different look than the one chosen.
    const r = createDeskSchema.safeParse({ ...base, theme_id: "neon-pink" });
    expect(r.success).toBe(false);
  });

  it("is optional, so an existing setup keeps its theme", () => {
    expect(createDeskSchema.safeParse(base).success).toBe(true);
  });
});

describe("template_ids", () => {
  it("accepts a subset", () => {
    const r = createDeskSchema.safeParse({
      ...base,
      template_ids: ["design-a"],
    });
    expect(r.success && r.data.template_ids).toEqual(["design-a"]);
  });

  it("refuses an empty list", () => {
    // A setup publishing nothing would sit in the scheduler every morning
    // doing nothing, with no signal that it was misconfigured.
    const r = createDeskSchema.safeParse({ ...base, template_ids: [] });
    expect(r.success).toBe(false);
  });

  it("refuses an unknown template", () => {
    const r = createDeskSchema.safeParse({
      ...base,
      template_ids: ["design-z"],
    });
    expect(r.success).toBe(false);
  });

  it("dedupes, so one style cannot be sent twice in an album", () => {
    const r = createDeskSchema.safeParse({
      ...base,
      template_ids: ["design-a", "design-a"],
    });
    expect(r.success && r.data.template_ids).toEqual(["design-a"]);
  });

  it("orders by POSTER_TEMPLATES regardless of how they were ticked", () => {
    // So the album always arrives in the same order, whichever order the
    // buttons were pressed in.
    const r = createDeskSchema.safeParse({
      ...base,
      template_ids: ["design-c", "design-a"],
    });
    expect(r.success && r.data.template_ids).toEqual(["design-a", "design-c"]);
  });

  it("accepts every template", () => {
    const all = POSTER_TEMPLATES.map((t) => t.id);
    const r = createDeskSchema.safeParse({ ...base, template_ids: all });
    expect(r.success && r.data.template_ids).toEqual(all);
  });
});

describe("updateDeskSchema", () => {
  it("allows changing appearance alone", () => {
    const r = updateDeskSchema.safeParse({ template_ids: ["design-b"] });
    expect(r.success).toBe(true);
  });

  it("applies the same rules on update as on create", () => {
    expect(updateDeskSchema.safeParse({ template_ids: [] }).success).toBe(false);
    expect(updateDeskSchema.safeParse({ theme_id: "nope" }).success).toBe(false);
  });
});
