import { describe, expect, it } from "vitest";
import { updateTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";

/**
 * The PATCH route's field-clearing contract.
 *
 * `updateTradeSchema` maps a blank/null input to `undefined` (so a cleared
 * optional input doesn't fail `.positive()`). That breaks an update twice:
 *
 *   1. `JSON.stringify` DROPS undefined keys, so a naive `update({...sentData})`
 *      never sends them and the column keeps its old value.
 *   2. `{...existing, ...sentData}` writes `undefined` over the old value, which
 *      slips past computeTradeFields' `!== null` guards and produces NaN.
 *
 * The route fixes both by normalizing present-but-undefined keys to `null`
 * BEFORE building either `merged` or `updatePatch`. These tests pin that.
 */

/** Mirrors the route exactly: filter to sent keys, then blank -> null. */
function routePipeline(body: Record<string, unknown>) {
  const parsed = updateTradeSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };

  const bodyKeys = new Set(Object.keys(body));
  const sentData = Object.fromEntries(
    Object.entries(parsed.data).filter(([k]) => bodyKeys.has(k)),
  ) as Record<string, unknown>;

  const normalized: Record<string, unknown> = { ...sentData };
  for (const key of bodyKeys) {
    if (key in normalized && normalized[key] === undefined) {
      normalized[key] = null;
    }
  }
  return { ok: true as const, parsed: parsed.data, bodyKeys, sentData, normalized };
}

/** What Supabase actually receives after JSON serialization. */
const overTheWire = (patch: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;

const CLEARABLE = [
  "stop_loss",
  "sl_pips",
  "lot_size",
  "entry_price_high",
  "risk_percent",
  "tp1",
  "tp2",
  "tp3",
  "tp4",
  "tp5",
  "tp6",
  "tp7",
  "tp1_pips",
  "tp2_pips",
  "tp3_pips",
  "tp4_pips",
  "tp5_pips",
  "tp6_pips",
  "tp7_pips",
] as const;

describe("clearing an optional field reaches the database", () => {
  it.each(CLEARABLE)("%s: null in the body becomes null on the wire", (field) => {
    const r = routePipeline({ [field]: null });
    if (!r.ok) throw new Error(`${field} rejected a null clear`);
    // Without normalization the key vanishes entirely...
    expect(overTheWire(r.sentData)).toEqual({});
    // ...with it, an explicit null reaches the column.
    expect(overTheWire(r.normalized)).toEqual({ [field]: null });
  });

  it.each(CLEARABLE)("%s: an empty string clears it too", (field) => {
    const r = routePipeline({ [field]: "" });
    if (!r.ok) throw new Error(`${field} rejected a blank clear`);
    expect(overTheWire(r.normalized)).toEqual({ [field]: null });
  });

  it("a real value is untouched by the normalization", () => {
    const r = routePipeline({ stop_loss: 1.085, risk_percent: 0.5 });
    if (!r.ok) throw new Error("expected parse to succeed");
    expect(r.normalized.stop_loss).toBe(1.085);
    expect(r.normalized.risk_percent).toBe(0.5);
  });

  it("a field absent from the body is never written", () => {
    const r = routePipeline({ notes: "just a note" });
    if (!r.ok) throw new Error("expected parse to succeed");
    for (const field of CLEARABLE) {
      expect(field in r.normalized).toBe(false);
    }
    expect(overTheWire(r.normalized)).toEqual({ notes: "just a note" });
  });
});

describe("fields carrying a Zod .default() are unaffected", () => {
  // The blanket coercion is only safe because these can never parse to
  // undefined — the default replaces it, or the value is rejected outright.
  it("defaults resolve to their default value, never undefined", () => {
    for (const [field, expected] of [
      ["fees", 0],
      ["split_risk", false],
      ["tp4_trailing", false],
    ] as const) {
      const r = routePipeline({ [field]: null });
      if (!r.ok) throw new Error(`${field} unexpectedly rejected`);
      expect(r.normalized[field]).toBe(expected);
      expect(r.normalized[field]).not.toBeNull();
    }
  });

  it("non-coercible defaults are rejected before they can be nulled", () => {
    for (const field of ["num_positions", "order_type", "tags", "source"]) {
      expect(routePipeline({ [field]: null }).ok).toBe(false);
    }
  });
});

describe("computeTradeFields when a stop loss is cleared", () => {
  const base = {
    instrument: "EURUSD",
    asset_type: "forex",
    direction: "buy",
    entry_price: 1.1,
    exit_price: 1.11,
    quantity: 10_000,
    fees: 0,
    stop_loss: 1.09,
    tp1: null,
    tp1_result: null,
    num_positions: 1,
    split_risk: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compute = (o: Record<string, unknown>) => computeTradeFields(o as any);

  it("with a stop, R multiple is derived", () => {
    expect(compute(base).r_multiple).toBeCloseTo(1, 6);
  });

  it("cleared to null, R multiple is null — not NaN", () => {
    // An R multiple has no denominator without a stop. NaN here would serialize
    // to null by luck; null is what the guard is actually written for.
    const out = compute({ ...base, stop_loss: null });
    expect(out.r_multiple).toBeNull();
    expect(Number.isNaN(out.r_multiple as number)).toBe(false);
  });

  it("REGRESSION: undefined would have produced NaN", () => {
    // This is what the route used to hand computeTradeFields, and why the
    // normalization has to run BEFORE `merged` is built, not just before the
    // update payload.
    const out = compute({ ...base, stop_loss: undefined });
    expect(Number.isNaN(out.r_multiple as number)).toBe(true);
  });

  it("P&L survives a cleared stop — it doesn't depend on one", () => {
    const withStop = compute(base);
    const cleared = compute({ ...base, stop_loss: null });
    expect(cleared.pnl_absolute).toBeCloseTo(withStop.pnl_absolute as number, 6);
  });

  it("risk:reward also drops to null without a stop", () => {
    const cleared = compute({ ...base, stop_loss: null, tp1: 1.12 });
    expect(cleared.risk_reward_ratio).toBeNull();
  });

  it("the route's normalization feeds null, so the guards work end to end", () => {
    const r = routePipeline({ stop_loss: null });
    if (!r.ok) throw new Error("expected parse to succeed");
    const out = compute({ ...base, ...r.normalized });
    expect(out.r_multiple).toBeNull();
  });
});

describe("risk_percent validation", () => {
  it("a real value passes through, strings are coerced", () => {
    expect(routePipeline({ risk_percent: 0.5 }).ok).toBe(true);
    const r = routePipeline({ risk_percent: "2.5" });
    expect(r.ok && r.normalized.risk_percent).toBe(2.5);
  });

  it("rejects a non-positive override rather than storing it", () => {
    expect(routePipeline({ risk_percent: 0 }).ok).toBe(false);
    expect(routePipeline({ risk_percent: -1 }).ok).toBe(false);
  });

  it("rejects >100% at the API instead of 500-ing on the DB CHECK", () => {
    // The column has `risk_percent > 0 and <= 100`. Without .max(100) a payload
    // of 500 passes validation and dies at the constraint, surfacing as a 500
    // with a raw Postgres string instead of a clean 400.
    expect(routePipeline({ risk_percent: 101 }).ok).toBe(false);
    expect(routePipeline({ risk_percent: 500 }).ok).toBe(false);
    expect(routePipeline({ risk_percent: "1000000000" }).ok).toBe(false);
    expect(routePipeline({ risk_percent: 100 }).ok).toBe(true);
  });

  it("rejects junk that would land as NaN in a numeric column", () => {
    for (const bad of ["abc", Number.NaN, "Infinity", []]) {
      expect(routePipeline({ risk_percent: bad }).ok).toBe(false);
    }
  });
});
