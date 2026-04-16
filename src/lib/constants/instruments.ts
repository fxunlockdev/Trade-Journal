export const FOREX_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "GBPJPY",
  "AUDUSD",
  "USDCHF",
  "NZDUSD",
  "USDCAD",
  "EURJPY",
  "EURGBP",
] as const;

export const CRYPTO_PAIRS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
] as const;

export const METALS = ["XAUUSD", "XAGUSD"] as const;

export const ALL_INSTRUMENTS = [
  ...FOREX_PAIRS,
  ...CRYPTO_PAIRS,
  ...METALS,
] as const;

export const JPY_PAIRS = [
  "USDJPY",
  "GBPJPY",
  "EURJPY",
  "AUDJPY",
  "NZDJPY",
  "CADJPY",
  "CHFJPY",
] as const;

export type ForexPair = (typeof FOREX_PAIRS)[number];
export type CryptoPair = (typeof CRYPTO_PAIRS)[number];
export type Metal = (typeof METALS)[number];
export type Instrument = (typeof ALL_INSTRUMENTS)[number];
