// ── Forex ──────────────────────────────────────────────────────────────────
export const FOREX_MAJORS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
] as const;

export const FOREX_CROSSES = [
  "EURGBP", "EURJPY", "EURAUD", "EURCAD", "EURNZD", "EURCHF",
  "GBPJPY", "GBPAUD", "GBPCAD", "GBPNZD", "GBPCHF",
  "AUDJPY", "AUDNZD", "AUDCAD", "AUDCHF",
  "NZDJPY", "NZDCAD", "NZDCHF",
  "CADJPY", "CADCHF",
  "CHFJPY",
] as const;

export const FOREX_EXOTICS = [
  "USDSGD", "USDHKD", "USDMXN", "USDZAR", "USDTRY",
  "EURSEK", "EURNOK", "EURDKK",
] as const;

export const FOREX_PAIRS = [
  ...FOREX_MAJORS,
  ...FOREX_CROSSES,
  ...FOREX_EXOTICS,
] as const;

// ── Crypto ─────────────────────────────────────────────────────────────────
export const CRYPTO_PAIRS = [
  // Large caps — USDT quoted (Binance / most CEX style)
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
  // Mid caps — USDT quoted
  "LINKUSDT", "LTCUSDT", "ATOMUSDT", "UNIUSDT", "NEARUSDT",
  "APTUSDT", "ARBUSDT", "OPUSDT", "SHIBUSDT", "TRXUSDT",
  "FTMUSDT", "ALGOUSDT", "VETUSDT", "ICPUSDT", "FILUSDT",
  // USD quoted — CFD broker style (IC Markets, Pepperstone, FTMO, etc.)
  // These are the same coins but priced against USD (not USDT), which is
  // how MT4/MT5 brokers typically list crypto CFDs.
  "BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD",
  "ADAUSD", "DOGEUSD", "AVAXUSD", "DOTUSD", "LINKUSD",
  "LTCUSD", "UNIUSD", "NEARUSD",
  // BTC pairs
  "ETHBTC", "BNBBTC", "SOLBTC",
] as const;

// ── Metals ──────────────────────────────────────────────────────────────────
export const METALS = [
  "XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD",
  "XAUEUR", "XAUGBP", "XAUJPY",
] as const;

// ── Indices ─────────────────────────────────────────────────────────────────
export const INDICES = [
  "US30",    // Dow Jones
  "NAS100",  // Nasdaq 100
  "SPX500",  // S&P 500
  "GER40",   // DAX
  "UK100",   // FTSE 100
  "JPN225",  // Nikkei 225
  "AUS200",  // ASX 200
  "FRA40",   // CAC 40
  "ESP35",   // IBEX 35
  "HK50",    // Hang Seng
] as const;

// ── Commodities / Energy ────────────────────────────────────────────────────
export const COMMODITIES = [
  "USOIL",   // WTI Crude
  "UKOIL",   // Brent Crude
  "NATGAS",  // Natural Gas
  "COPPER",
  "CORN",
  "WHEAT",
] as const;

// ── Combined ─────────────────────────────────────────────────────────────────
export const ALL_INSTRUMENTS = [
  ...FOREX_PAIRS,
  ...CRYPTO_PAIRS,
  ...METALS,
  ...INDICES,
  ...COMMODITIES,
] as const;

// Kept for pip-calc helpers
export const JPY_PAIRS = [
  "USDJPY", "GBPJPY", "EURJPY", "AUDJPY",
  "NZDJPY", "CADJPY", "CHFJPY",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export type ForexPair    = (typeof FOREX_PAIRS)[number];
export type CryptoPair   = (typeof CRYPTO_PAIRS)[number];
export type Metal        = (typeof METALS)[number];
export type Index        = (typeof INDICES)[number];
export type Commodity    = (typeof COMMODITIES)[number];
export type Instrument   = (typeof ALL_INSTRUMENTS)[number];
