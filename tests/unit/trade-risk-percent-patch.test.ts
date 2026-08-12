import { describe, expect, it } from "vitest";
import { updateTradeSchema } from "@/lib/validators/trade";

/**
 * The PATCH route's field-clearing contract.
 *
 * `updateTradeSchema` maps a blank/null input to `undefined` (so a cleared
 * optional input doesn't fail `.positive()`), and `JSON.stringify` then DROPS
 * undefined keys — so a naive `update({...sentData})` silently keeps the old
 * value instead of clearing the column. The route compensates explicitly for
 * `risk_percent`; these tests pin both halves of that.
 */

/** Mirrors the route: act only on keys actually present in the request body. */
function sentDataFor(body: Record<string, unknown>) {
  const parsed = updateTradeSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
  const bodyKeys = new Set(Object.keys(body));
  return {
    ok: true as const,
    parsed: parsed.data,
    bodyKeys,
    sentData: Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => bodyKeys.has(k)),
    ) as Record<string, unknown>,
  };
}

describe("PATCH risk_percent", () => {
  it("a null override validates instead of 400-ing the whole edit", () => {
    expect(sentDataFor({ risk_percent: null }).ok).toBe(true);
    expect(sentDataFor({ risk_percent: "" }).ok).toBe(true);
  });

  it("a real value passes straight through", () => {
    const r = sentDataFor({ risk_percent: 0.5 });
    expect(r.ok && r.sentData.risk_percent).toBe(0.5);
  });

  it("strings from the form are coerced to numbers", () => {
    const r = sentDataFor({ risk_percent: "2.5" });
    expect(r.ok && r.sentData.risk_percent).toBe(2.5);
  });

  it("rejects a non-positive override rather than storing it", () => {
    expect(sentDataFor({ risk_percent: 0 }).ok).toBe(false);
    expect(sentDataFor({ risk_percent: -1 }).ok).toBe(false);
  });

  it("rejects >100% at the API instead of 500-ing on the DB CHECK", () => {
    // The column has `risk_percent > 0 and <= 100`. Without .max(100) here a
    // payload of 500 passes validation and dies at the constraint, surfacing as
    // a 500 with a raw Postgres string instead of a clean 400.
    expect(sentDataFor({ risk_percent: 101 }).ok).toBe(false);
    expect(sentDataFor({ risk_percent: 500 }).ok).toBe(false);
    expect(sentDataFor({ risk_percent: "1000000000" }).ok).toBe(false);
    // 100 is the boundary and is allowed (all-in, but legal).
    expect(sentDataFor({ risk_percent: 100 }).ok).toBe(true);
  });

  it("rejects junk that would land as NaN in a numeric column", () => {
    for (const bad of ["abc", Number.NaN, "Infinity", []]) {
      expect(sentDataFor({ risk_percent: bad }).ok).toBe(false);
    }
  });

  it("REGRESSION: a cleared override is dropped by JSON unless coerced to null", () => {
    const r = sentDataFor({ risk_percent: null });
    if (!r.ok) throw new Error("expected parse to succeed");
    // The key is present but undefined, so serialization loses it entirely —
    // this is exactly why the route can't just spread sentData.
    expect("risk_percent" in r.sentData).toBe(true);
    expect(r.sentData.risk_percent).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r.sentData))).toEqual({});

    // What the route actually sends: an explicit null that reaches the column.
    const patch: Record<string, unknown> = { ...r.sentData };
    if (r.bodyKeys.has("risk_percent")) {
      patch.risk_percent = r.parsed.risk_percent ?? null;
    }
    expect(JSON.parse(JSON.stringify(patch))).toEqual({ risk_percent: null });
  });

  it("an untouched risk_percent is never written on an unrelated edit", () => {
    const r = sentDataFor({ notes: "just a note" });
    if (!r.ok) throw new Error("expected parse to succeed");
    expect("risk_percent" in r.sentData).toBe(false);
    const patch: Record<string, unknown> = { ...r.sentData };
    if (r.bodyKeys.has("risk_percent")) {
      patch.risk_percent = r.parsed.risk_percent ?? null;
    }
    expect("risk_percent" in patch).toBe(false);
  });
});
