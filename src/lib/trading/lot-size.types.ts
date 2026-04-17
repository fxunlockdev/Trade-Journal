/**
 * Shared types for the lot-size calculator. Kept in a dedicated file so the
 * UI layer can import just the types without pulling in the whole spec table
 * or the calculation implementation.
 */

export type Direction = "buy" | "sell";

export type AssetClass =
  | "forex"
  | "metal"
  | "index"
  | "commodity"
  | "crypto";

/**
 * Supported account-base currencies for risk sizing. Kept small on purpose —
 * retail traders overwhelmingly use USD, EUR, or GBP funded accounts. Adding
 * another requires one entry in ACCOUNT_CCY_TO_USD_DEFAULT plus a label.
 */
export type AccountCurrency = "USD" | "EUR" | "GBP";

/**
 * Static spec for an instrument. Contract size + tick size + tick value
 * per standard lot are broker-dependent for CFDs, so these are sensible
 * industry defaults that the user can override per-instrument from the UI.
 *
 * pipSize is independent of the broker — it's a market convention (e.g.
 * forex minors use 0.0001, JPY pairs 0.01). tickSize is typically one order
 * of magnitude smaller (10-tick = 1 pip in fractional-pip quoting).
 *
 * quoteCurrency + baseCurrency drive the FX conversion math. For non-forex
 * CFDs, quoteCurrency is still meaningful (it's the currency the P/L is
 * denominated in at the broker).
 */
export interface InstrumentSpec {
  readonly symbol: string;
  readonly assetClass: AssetClass;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly pipSize: number;
  readonly tickSize: number;
  /** USD value of one tick for one standard lot. */
  readonly tickValuePerLotUSD: number;
  /** Units per standard lot. 100,000 for forex; varies for CFDs. */
  readonly contractSize: number;
}

/**
 * User-editable overrides. Each is optional; undefined means "use spec
 * default". Persisted to localStorage keyed by instrument symbol.
 */
export interface SpecOverrides {
  readonly contractSize?: number;
  readonly tickSize?: number;
  readonly tickValuePerLotUSD?: number;
  readonly pipSize?: number;
}

/**
 * Inputs the calculator takes. All prices are numbers; the UI handles the
 * string→number coercion so this function stays pure and simple.
 *
 * `quoteToAccountRate` is the user-supplied current mid price of
 * (quote currency)/(account currency) — only required when the instrument's
 * quote currency differs from the account currency (e.g. USDJPY on a USD
 * account needs USDJPY itself; EURGBP on a USD account needs GBPUSD).
 * The UI prompts only when needed.
 */
export interface LotSizeInput {
  readonly accountBalance: number;
  readonly accountCurrency: AccountCurrency;
  readonly riskPercent: number;
  readonly instrument: string;
  readonly direction: Direction;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly rewardRatio: number;
  readonly leverage?: number;
  readonly quoteToAccountRate?: number;
  readonly overrides?: SpecOverrides;
}

/**
 * A warning tagged with a level so the UI can decide severity (amber vs red).
 */
export interface LotSizeWarning {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

/**
 * Result of a successful calculation. If the inputs are internally
 * inconsistent (SL on wrong side of entry, zero distance, etc.), the
 * calculator returns `null` and the UI shows a placeholder.
 */
export interface LotSizeResult {
  /** Number of underlying units (e.g. currency units, ounces, contracts). */
  readonly units: number;
  readonly standardLots: number;
  readonly miniLots: number;
  readonly microLots: number;
  /** USD value of 1 pip movement for 1 standard lot (pre-conversion). */
  readonly pipValuePerLotUSD: number;
  /** Same pip value expressed in the trader's account currency. */
  readonly pipValuePerLotAccount: number;
  readonly dollarRisk: number;
  readonly rewardAmount: number;
  readonly targetPrice: number;
  readonly priceDistance: number;
  readonly pipsAtRisk: number;
  /** Position notional in account currency (units × entry × fx). */
  readonly notionalAccount: number;
  /** Only populated when leverage is provided and > 0. */
  readonly marginRequiredAccount: number | null;
  readonly warnings: ReadonlyArray<LotSizeWarning>;
  /** The spec actually used (after applying any overrides). */
  readonly effectiveSpec: InstrumentSpec;
}
