import { JPY_PAIRS } from "@/lib/constants/instruments";
import type { TradeDirection } from "@/types/database";

export function isJpyPair(instrument: string): boolean {
  return (JPY_PAIRS as readonly string[]).includes(instrument.toUpperCase());
}

export function computePipValue(instrument: string): number {
  const upper = instrument.toUpperCase();
  if (isJpyPair(upper)) return 0.01;
  if (upper.startsWith("XAU") || upper.startsWith("XAG")) return 0.01;
  if (upper.endsWith("USDT") || upper.endsWith("USD") === false && upper.endsWith("BTC")) return 1;
  return 0.0001;
}

export function computePipsDifference(
  price1: number,
  price2: number,
  instrument: string,
): number {
  const pipValue = computePipValue(instrument);
  if (pipValue === 0) return 0;
  return Math.abs(price1 - price2) / pipValue;
}

interface SignalForComputation {
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entry_price: number;
  readonly stop_loss: number;
  readonly tp1: number | null;
}

export function computeSignalFields<T extends SignalForComputation>(
  signal: T,
): T & {
  readonly pips_to_sl: number;
  readonly pips_to_tp1: number | null;
} {
  const pipsToSl = computePipsDifference(
    signal.entry_price,
    signal.stop_loss,
    signal.instrument,
  );

  const pipsToTp1 =
    signal.tp1 !== null
      ? computePipsDifference(signal.entry_price, signal.tp1, signal.instrument)
      : null;

  return {
    ...signal,
    pips_to_sl: pipsToSl,
    pips_to_tp1: pipsToTp1,
  };
}
