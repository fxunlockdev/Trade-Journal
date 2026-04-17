import {
  CRYPTO_PAIRS,
  INDICES,
  COMMODITIES,
} from "@/lib/constants/instruments";

// Fast lookup sets built once at module load.
const CRYPTO_SET = new Set<string>(CRYPTO_PAIRS);
const INDICES_SET = new Set<string>(INDICES);
const COMMODITIES_SET = new Set<string>(COMMODITIES);

// Gold, Silver, Platinum, Palladium → 1 pip = 0.01.
// XAUEUR/XAUGBP/XAUJPY track the quote currency decimal convention:
// XAUJPY uses 0.01 (JPY pair), XAUEUR/XAUGBP use 0.01 too (gold convention).
const METALS_POINT_01 = new Set<string>([
  "XAUUSD",
  "XAGUSD",
  "XPTUSD",
  "XPDUSD",
  "XAUEUR",
  "XAUGBP",
  "XAUJPY",
]);

/**
 * A pair is a crypto pair if it's in our known list OR if it ends in a common
 * crypto stablecoin/base suffix.
 */
const CRYPTO_SUFFIXES = [
  "USDT",
  "USDC",
  "BUSD",
  "BTC", // ETHBTC, SOLBTC, BNBBTC etc.
] as const;

export function isJpyPair(instrument: string): boolean {
  const upper = instrument.toUpperCase();
  // Only flag true forex JPY pairs — XAUJPY is handled by the metals table.
  if (METALS_POINT_01.has(upper)) return false;
  return upper.endsWith("JPY") && upper.length === 6;
}

function isCryptoPair(upper: string): boolean {
  if (CRYPTO_SET.has(upper)) return true;
  return CRYPTO_SUFFIXES.some((s) => upper.endsWith(s));
}

/**
 * Pip value = the price increment that counts as "one pip" for this instrument.
 *
 * Conventions:
 * - Forex major/cross: 0.0001
 * - Forex JPY pair:    0.01
 * - Metals (gold/silver/platinum/palladium and gold crosses): 0.01
 * - Crypto:            1   (treat whole-number price moves as 1 pip)
 * - Indices:           1   (index points — US30 at 38500 etc.)
 * - Commodities:       0.01 (USOIL/UKOIL quoted to 2 decimals; NATGAS ≈ 0.001 but 0.01 is a safer default)
 */
export function computePipValue(instrument: string): number {
  const upper = instrument.toUpperCase();

  if (METALS_POINT_01.has(upper)) return 0.01;
  if (isCryptoPair(upper)) return 1;
  if (INDICES_SET.has(upper)) return 1;
  if (COMMODITIES_SET.has(upper)) return 0.01;
  if (isJpyPair(upper)) return 0.01;

  return 0.0001;
}

export function computePipsDifference(
  price1: number,
  price2: number,
  instrument: string,
): number {
  const pipValue = computePipValue(instrument);
  if (!Number.isFinite(price1) || !Number.isFinite(price2) || pipValue <= 0) {
    return 0;
  }
  const raw = Math.abs(price1 - price2) / pipValue;
  return Math.round(raw * 10) / 10;
}

interface SignalPriceFields {
  readonly entry_price: number;
  readonly stop_loss: number;
  readonly tp1: number | null;
  readonly instrument: string;
}

interface ComputedFields {
  readonly pips_to_sl: number;
  readonly pips_to_tp1: number | null;
}

export function computeSignalFields(signal: SignalPriceFields): ComputedFields {
  const pips_to_sl = computePipsDifference(
    signal.entry_price,
    signal.stop_loss,
    signal.instrument,
  );

  const pips_to_tp1 =
    signal.tp1 !== null
      ? computePipsDifference(
          signal.entry_price,
          signal.tp1,
          signal.instrument,
        )
      : null;

  return { pips_to_sl, pips_to_tp1 };
}
