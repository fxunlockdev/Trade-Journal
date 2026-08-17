/**
 * Rebate rates used by the Rebate Calculator.
 *
 * ⚠️ THESE ARE ILLUSTRATIVE PLACEHOLDERS, NOT FXU'S COMMERCIAL TERMS.
 * They are industry-typical ranges so the tool is usable today; replace them
 * with the real per-lot rebates before promoting the calculator to partners.
 * This is the ONLY file that needs editing — the UI, the estimate and the
 * captured lead all read from here.
 *
 * Rates are USD per standard lot (1.0 lot) of round-turn volume.
 */

export type AssetClass = "gold" | "forex" | "crypto" | "mixed";

export interface AssetRate {
  readonly key: AssetClass;
  readonly label: string;
  /** Conservative end of the per-lot rebate, USD. */
  readonly min: number;
  /** Typical/again-negotiable end of the per-lot rebate, USD. */
  readonly max: number;
  readonly note: string;
}

export const ASSET_RATES: readonly AssetRate[] = [
  {
    key: "gold",
    label: "Gold (XAUUSD)",
    min: 6,
    max: 9,
    note: "Metals usually carry the highest per-lot rebate.",
  },
  {
    key: "forex",
    label: "Forex majors & minors",
    min: 4,
    max: 7,
    note: "The steadiest volume base for most IB books.",
  },
  {
    key: "crypto",
    label: "Crypto CFDs",
    min: 3,
    max: 6,
    note: "Rebate varies most with the underlying spread.",
  },
  {
    key: "mixed",
    label: "Mixed book (all of the above)",
    min: 4,
    max: 8,
    note: "A blended rate across a typical multi-asset book.",
  },
];

export function rateFor(asset: AssetClass): AssetRate {
  return ASSET_RATES.find((r) => r.key === asset) ?? ASSET_RATES[3];
}

export interface RebateEstimate {
  readonly monthlyLow: number;
  readonly monthlyHigh: number;
  readonly monthlyMid: number;
  readonly annualMid: number;
  readonly perLotLow: number;
  readonly perLotHigh: number;
}

/** Pure function — same inputs always give the same estimate. */
export function estimateRebate(asset: AssetClass, monthlyLots: number): RebateEstimate {
  const rate = rateFor(asset);
  const lots = Number.isFinite(monthlyLots) && monthlyLots > 0 ? monthlyLots : 0;
  const monthlyLow = lots * rate.min;
  const monthlyHigh = lots * rate.max;
  const monthlyMid = (monthlyLow + monthlyHigh) / 2;
  return {
    monthlyLow,
    monthlyHigh,
    monthlyMid,
    annualMid: monthlyMid * 12,
    perLotLow: rate.min,
    perLotHigh: rate.max,
  };
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
