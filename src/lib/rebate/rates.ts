/**
 * Rebate rates used by the Rebate Calculator.
 *
 * ⚠️ The defaults below are ILLUSTRATIVE, industry-typical ranges — NOT FXU's
 * commercial terms. Set the real ones without a code change via the env var
 * NEXT_PUBLIC_REBATE_RATES (Vercel → Settings → Environment Variables):
 *
 *   NEXT_PUBLIC_REBATE_RATES=gold:6-9,forex:4-7,crypto:3-6,mixed:4-8
 *
 * Anything omitted keeps its default. Malformed entries are ignored rather than
 * crashing the page — a broken env var must not take a public tool down.
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

const DEFAULT_RATES: readonly AssetRate[] = [
  {
    key: "gold",
    label: "Gold (XAUUSD)",
    // Confirmed FXU rate. The others below are still illustrative until you
    // give me their real numbers.
    min: 25,
    max: 35,
    note: "Gold carries the strongest per-lot rebate on the book.",
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

/**
 * Parse "gold:6-9,forex:4-7" into per-asset overrides. Tolerant by design:
 * a bad pair is skipped, never thrown.
 */
function parseOverrides(raw: string | undefined): ReadonlyMap<string, { min: number; max: number }> {
  const out = new Map<string, { min: number; max: number }>();
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [key, range] = pair.split(":").map((x) => x?.trim().toLowerCase());
    if (!key || !range) continue;
    const [minRaw, maxRaw] = range.split("-");
    const min = Number(minRaw);
    const max = Number(maxRaw ?? minRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) continue;
    out.set(key, { min, max });
  }
  return out;
}

const OVERRIDES = parseOverrides(process.env.NEXT_PUBLIC_REBATE_RATES);

export const ASSET_RATES: readonly AssetRate[] = DEFAULT_RATES.map((r) => {
  const o = OVERRIDES.get(r.key);
  return o ? { ...r, min: o.min, max: o.max } : r;
});

/**
 * Gold is a confirmed FXU rate; forex, crypto and the blended book are still
 * industry-typical placeholders. The calculator says so rather than implying
 * every figure is contractual.
 */
export const CONFIRMED_ASSETS: readonly AssetClass[] = ["gold"];

export function isConfirmedRate(asset: AssetClass): boolean {
  return OVERRIDES.has(asset) || CONFIRMED_ASSETS.includes(asset);
}

/** True while ANY asset is still on a placeholder rate. */
export const RATES_ARE_ILLUSTRATIVE =
  ASSET_RATES.some((r) => !OVERRIDES.has(r.key) && !CONFIRMED_ASSETS.includes(r.key));

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
