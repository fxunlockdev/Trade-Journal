import { describe, it, expect } from "vitest";
import { estimateRebate, rateFor, formatUsd, ASSET_RATES } from "@/lib/rebate/rates";

describe("rebate estimate", () => {
  it("multiplies volume by the per-lot range", () => {
    const gold = rateFor("gold");
    const e = estimateRebate("gold", 100);
    expect(e.monthlyLow).toBe(100 * gold.min);
    expect(e.monthlyHigh).toBe(100 * gold.max);
    expect(e.monthlyMid).toBe((100 * gold.min + 100 * gold.max) / 2);
  });

  it("projects the year from the midpoint", () => {
    const e = estimateRebate("forex", 250);
    expect(e.annualMid).toBe(e.monthlyMid * 12);
  });

  it("treats zero, negative and non-finite volume as zero", () => {
    for (const v of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const e = estimateRebate("gold", v);
      expect(e.monthlyLow).toBe(0);
      expect(e.monthlyHigh).toBe(0);
      expect(e.annualMid).toBe(0);
    }
  });

  it("falls back to the mixed book for an unknown asset", () => {
    // Cast: the point is to prove a bad value from the wire can't crash it.
    const r = rateFor("shares" as never);
    expect(r.key).toBe("mixed");
  });

  it("every asset has a sane range", () => {
    for (const r of ASSET_RATES) {
      expect(r.min).toBeGreaterThan(0);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("formats as whole dollars", () => {
    expect(formatUsd(750)).toBe("$750");
    expect(formatUsd(1234.56)).toBe("$1,235");
  });
});
