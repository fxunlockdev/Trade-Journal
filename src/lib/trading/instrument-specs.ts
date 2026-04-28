import {
  ALL_INSTRUMENTS,
  COMMODITIES,
  CRYPTO_PAIRS,
  FOREX_PAIRS,
  INDICES,
  METALS,
} from "@/lib/constants/instruments";
import type { AssetClass, InstrumentSpec } from "./lot-size.types";

/**
 * Lookup table of default CFD / forex specs. Contract sizes and tick values
 * vary by broker — these are industry-typical values matching what the
 * majority of retail brokers (IC Markets, Pepperstone, OANDA, FTMO, etc.)
 * publish. The UI exposes per-instrument overrides for traders whose broker
 * uses different numbers.
 *
 * Notes on the forex numbers:
 *   - Standard lot = 100,000 base units (universal).
 *   - A "pip" on 4-decimal forex = 0.0001; on JPY pairs = 0.01.
 *   - Tick size is 1/10 of a pip (5-decimal / 3-decimal "pipette" quoting).
 *   - pipValuePerLot in USD is recomputed at calc time because it depends on
 *     the live rate for cross and USD/XXX pairs. The baseline `tickValueUSD`
 *     stored here is for the XXX/USD direct case; the calculator handles
 *     conversion for the other two cases.
 *
 * Notes on the CFD numbers (broker-typical):
 *   - XAUUSD: 100 oz/lot, 0.01 tick, $1/tick per lot (so 1 pip=0.01 → $1/lot).
 *   - XAGUSD: 5000 oz/lot, 0.001 tick, $0.50/tick per lot.
 *   - XPTUSD / XPDUSD: 100 oz/lot, 0.01 tick, $1/tick per lot (treat like gold).
 *   - US30 / NAS100 / SPX500 / GER40 etc.: 1 contract, 1 pt tick, $1/pt per lot.
 *   - USOIL / UKOIL: 1,000 bbl/lot, 0.01 tick, $10/tick per lot.
 *   - NATGAS: 10,000 MMBtu/lot, 0.001 tick, $10/tick per lot.
 *   - COPPER / CORN / WHEAT: approximated to $10/tick at 0.01 increments.
 *   - Crypto CFDs: 1 coin/lot, 0.01 tick, $0.01/tick per lot (so 1 USD move = 1 USD per coin held, which matches real crypto spot P/L).
 */

const FOREX_SET = new Set<string>(FOREX_PAIRS);
const CRYPTO_SET = new Set<string>(CRYPTO_PAIRS);
const METAL_SET = new Set<string>(METALS);
const INDEX_SET = new Set<string>(INDICES);
const COMMODITY_SET = new Set<string>(COMMODITIES);

function assetClassOf(symbol: string): AssetClass {
  if (FOREX_SET.has(symbol)) return "forex";
  if (CRYPTO_SET.has(symbol)) return "crypto";
  if (METAL_SET.has(symbol)) return "metal";
  if (INDEX_SET.has(symbol)) return "index";
  if (COMMODITY_SET.has(symbol)) return "commodity";
  // Suffix-based fallback for custom symbols the user types in
  if (symbol.endsWith("USDT") || symbol.endsWith("USDC") || symbol.endsWith("BTC")) {
    return "crypto";
  }
  return "forex";
}

function isJpyForex(symbol: string): boolean {
  return symbol.length === 6 && symbol.endsWith("JPY") && FOREX_SET.has(symbol);
}

/**
 * Parse the quote currency out of a 6-char forex symbol. For non-forex
 * symbols we default to USD which covers ~all USD-quoted CFDs. XAUEUR etc.
 * are handled by the explicit metals table below.
 */
function parseForexCurrencies(symbol: string): {
  readonly base: string;
  readonly quote: string;
} {
  if (symbol.length === 6) {
    return { base: symbol.slice(0, 3), quote: symbol.slice(3) };
  }
  return { base: symbol, quote: "USD" };
}

interface CfdOverrideRow {
  readonly pipSize: number;
  readonly tickSize: number;
  readonly tickValuePerLotUSD: number;
  readonly contractSize: number;
  readonly quote?: string;
  readonly base?: string;
}

/**
 * Explicit CFD overrides for instruments where the generic asset-class
 * defaults don't fit (e.g. silver has a different contract size than gold,
 * oil uses bigger tick values, etc.).
 */
const CFD_OVERRIDES: Readonly<Record<string, CfdOverrideRow>> = {
  // Crypto USD-quoted CFDs (broker style: BTCUSD, ETHUSD, …)
  // BTC: 1 pip = $1 (industry convention — "remove 2 decimal units" vs 0.01).
  // ETH and others remain at $0.01/pip.
  BTCUSD:  { pipSize: 1,    tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "BTC",  quote: "USD" },
  BTCUSDT: { pipSize: 1,    tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "BTC",  quote: "USDT" },
  ETHUSD:  { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "ETH",  quote: "USD" },
  BNBUSD:  { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "BNB",  quote: "USD" },
  SOLUSD:  { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "SOL",  quote: "USD" },
  XRPUSD:  { pipSize: 0.0001, tickSize: 0.0001, tickValuePerLotUSD: 0.0001, contractSize: 1, base: "XRP",  quote: "USD" },
  ADAUSD:  { pipSize: 0.0001, tickSize: 0.0001, tickValuePerLotUSD: 0.0001, contractSize: 1, base: "ADA",  quote: "USD" },
  DOGEUSD: { pipSize: 0.0001, tickSize: 0.0001, tickValuePerLotUSD: 0.0001, contractSize: 1, base: "DOGE", quote: "USD" },
  AVAXUSD: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "AVAX", quote: "USD" },
  DOTUSD:  { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 0.001, contractSize: 1, base: "DOT",  quote: "USD" },
  LINKUSD: { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 0.001, contractSize: 1, base: "LINK", quote: "USD" },
  LTCUSD:  { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 0.01, contractSize: 1, base: "LTC",  quote: "USD" },
  UNIUSD:  { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 0.001, contractSize: 1, base: "UNI",  quote: "USD" },
  NEARUSD: { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 0.001, contractSize: 1, base: "NEAR", quote: "USD" },

  // Metals
  // XAU: 1 pip = $0.10 ("remove 1 decimal unit" from 0.01 → 0.1).
  // A $10 gold move = 100 pips, matching standard broker/MT5 pip display.
  XAUUSD: { pipSize: 0.1,  tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XAU", quote: "USD" },
  XAGUSD: { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 0.5, contractSize: 5000, base: "XAG", quote: "USD" },
  XPTUSD: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XPT", quote: "USD" },
  XPDUSD: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XPD", quote: "USD" },
  XAUEUR: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XAU", quote: "EUR" },
  XAUGBP: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XAU", quote: "GBP" },
  XAUJPY: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 1, contractSize: 100, base: "XAU", quote: "JPY" },

  // Energy
  USOIL: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 10, contractSize: 1000, base: "WTI", quote: "USD" },
  UKOIL: { pipSize: 0.01, tickSize: 0.01, tickValuePerLotUSD: 10, contractSize: 1000, base: "BRENT", quote: "USD" },
  NATGAS: { pipSize: 0.001, tickSize: 0.001, tickValuePerLotUSD: 10, contractSize: 10000, base: "NG", quote: "USD" },

  // Ag / metals commodities
  COPPER: { pipSize: 0.0001, tickSize: 0.0001, tickValuePerLotUSD: 2.5, contractSize: 25000, base: "HG", quote: "USD" },
  CORN: { pipSize: 0.25, tickSize: 0.25, tickValuePerLotUSD: 12.5, contractSize: 5000, base: "ZC", quote: "USD" },
  WHEAT: { pipSize: 0.25, tickSize: 0.25, tickValuePerLotUSD: 12.5, contractSize: 5000, base: "ZW", quote: "USD" },
};

function buildSpec(symbol: string): InstrumentSpec {
  const upper = symbol.toUpperCase();
  const assetClass = assetClassOf(upper);

  // 1) CFD overrides take precedence.
  const override = CFD_OVERRIDES[upper];
  if (override) {
    return {
      symbol: upper,
      assetClass,
      baseCurrency: override.base ?? upper,
      quoteCurrency: override.quote ?? "USD",
      pipSize: override.pipSize,
      tickSize: override.tickSize,
      tickValuePerLotUSD: override.tickValuePerLotUSD,
      contractSize: override.contractSize,
    };
  }

  // 2) Forex defaults.
  if (assetClass === "forex") {
    const { base, quote } = parseForexCurrencies(upper);
    const pip = isJpyForex(upper) ? 0.01 : 0.0001;
    return {
      symbol: upper,
      assetClass: "forex",
      baseCurrency: base,
      quoteCurrency: quote,
      pipSize: pip,
      tickSize: pip / 10,
      // pipValue for 1 lot of XXX/quote = pipSize × contractSize in QUOTE currency.
      // Store the USD equivalent assuming a direct-quote USD pair baseline
      // ($10/pip/lot). The calculator converts for USD/XXX and crosses.
      tickValuePerLotUSD: 1, // $1 per tick (0.00001) for a 100k lot of XXX/USD
      contractSize: 100000,
    };
  }

  // 3) Index CFD generic default.
  if (assetClass === "index") {
    return {
      symbol: upper,
      assetClass: "index",
      baseCurrency: upper,
      quoteCurrency: "USD",
      pipSize: 1,
      tickSize: 1,
      tickValuePerLotUSD: 1,
      contractSize: 1,
    };
  }

  // 4) Crypto CFD generic default — 1 coin per lot, $/tick = tickSize USD.
  //    pipSize must equal tickSize (both 0.01) — the previous value of 1
  //    made "pips at risk" report 100x smaller than reality because
  //    pipsAtRisk = priceDistance / pipSize and priceDistance is in USD.
  if (assetClass === "crypto") {
    return {
      symbol: upper,
      assetClass: "crypto",
      baseCurrency: upper.replace(/USDT|USDC|USD|BTC$/i, "") || upper,
      quoteCurrency: upper.endsWith("BTC") ? "BTC" : "USD",
      pipSize: 0.01,
      tickSize: 0.01,
      tickValuePerLotUSD: 0.01,
      contractSize: 1,
    };
  }

  // 5) Fallback — treat as a 0.01 tick, $1/tick, 100-unit instrument.
  //    Covers edge-case custom symbols without crashing.
  return {
    symbol: upper,
    assetClass,
    baseCurrency: upper,
    quoteCurrency: "USD",
    pipSize: 0.01,
    tickSize: 0.01,
    tickValuePerLotUSD: 1,
    contractSize: 100,
  };
}

/** Module-level cache: specs are pure functions of the symbol. */
const SPEC_CACHE = new Map<string, InstrumentSpec>();

for (const sym of ALL_INSTRUMENTS) {
  SPEC_CACHE.set(sym, buildSpec(sym));
}

/**
 * Return the default spec for an instrument. Unknown symbols get a sane
 * fallback built on the fly (and cached). Case-insensitive.
 */
export function getInstrumentSpec(instrument: string): InstrumentSpec {
  const upper = instrument.trim().toUpperCase();
  const hit = SPEC_CACHE.get(upper);
  if (hit) return hit;
  const built = buildSpec(upper);
  SPEC_CACHE.set(upper, built);
  return built;
}

/**
 * Apply user-provided overrides on top of the default spec. Returns a new
 * InstrumentSpec — never mutates the cached default.
 */
export function applyOverrides(
  spec: InstrumentSpec,
  overrides: {
    readonly contractSize?: number;
    readonly tickSize?: number;
    readonly tickValuePerLotUSD?: number;
    readonly pipSize?: number;
  } | undefined,
): InstrumentSpec {
  if (!overrides) return spec;
  const safe = (n: number | undefined, fallback: number): number =>
    n !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
  return {
    ...spec,
    contractSize: safe(overrides.contractSize, spec.contractSize),
    tickSize: safe(overrides.tickSize, spec.tickSize),
    tickValuePerLotUSD: safe(
      overrides.tickValuePerLotUSD,
      spec.tickValuePerLotUSD,
    ),
    pipSize: safe(overrides.pipSize, spec.pipSize),
  };
}
