const CRYPTO_SUFFIXES = ["USDT", "USDC", "BUSD"] as const;
const METALS_WITH_SMALL_PIP = ["XAUUSD", "XAGUSD"] as const;

export function isJpyPair(instrument: string): boolean {
  return instrument.toUpperCase().includes("JPY");
}

export function computePipValue(instrument: string): number {
  const upper = instrument.toUpperCase();

  if (isJpyPair(upper)) {
    return 0.01;
  }

  if (METALS_WITH_SMALL_PIP.some((m) => upper === m)) {
    return 0.01;
  }

  if (CRYPTO_SUFFIXES.some((suffix) => upper.endsWith(suffix))) {
    return 1;
  }

  return 0.0001;
}

export function computePipsDifference(
  price1: number,
  price2: number,
  instrument: string,
): number {
  const pipValue = computePipValue(instrument);
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
