import { applyOverrides, getInstrumentSpec } from "./instrument-specs";
import { quoteToUsdFactor } from "./quote-conversion";
import type {
  AccountCurrency,
  InstrumentSpec,
  LotSizeInput,
  LotSizeResult,
  LotSizeWarning,
} from "./lot-size.types";

/**
 * Lot-size calculator — single entry point for the UI.
 *
 * Returns `null` when the inputs are self-inconsistent (zero balance, invalid
 * prices, SL on the wrong side of entry). In that case the UI shows a
 * placeholder rather than nonsense numbers.
 *
 * All math is done in USD first, then converted to the account currency at
 * the end. This keeps the forex conversion logic in one place.
 */
export function computeLotSize(input: LotSizeInput): LotSizeResult | null {
  const {
    accountBalance,
    accountCurrency,
    riskPercent,
    instrument,
    direction,
    entryPrice,
    stopLossPrice,
    rewardRatio,
    leverage,
    quoteToAccountRate,
    overrides,
  } = input;

  // ── Sanity gates ────────────────────────────────────────────────────────
  if (!Number.isFinite(accountBalance) || accountBalance <= 0) return null;
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) return null;
  if (!Number.isFinite(rewardRatio) || rewardRatio <= 0) return null;

  if (direction === "buy" && stopLossPrice >= entryPrice) return null;
  if (direction === "sell" && stopLossPrice <= entryPrice) return null;

  const priceDistance = Math.abs(entryPrice - stopLossPrice);
  if (priceDistance <= 0 || !Number.isFinite(priceDistance)) return null;

  // ── Resolve spec (with overrides) ───────────────────────────────────────
  const rawSpec = getInstrumentSpec(instrument);
  const spec = applyOverrides(rawSpec, overrides);

  // ── Risk money (account currency) → USD for internal math ──────────────
  const accountToUsd = accountCcyToUsd(accountCurrency);
  const riskAccount = accountBalance * (riskPercent / 100);
  const riskUSD = riskAccount * accountToUsd;

  // ── Per-unit risk in USD (the keystone of the whole calc) ──────────────
  //
  // The broker tells us: "1 tick move of tickSize = tickValuePerLotUSD per
  // standard lot". We convert that to "USD per 1 unit per 1 price unit":
  //   valuePerUnitPerPricePoint_USD = tickValuePerLotUSD / tickSize / contractSize
  //
  // This is a universal expression that works for forex, metals, indices,
  // commodities, and crypto CFDs. The per-asset-class details are baked
  // into the spec table.
  //
  // For forex with a non-USD quote we then correct for the conversion
  // between the quote currency and USD (see convertQuoteToUSD below).
  const valuePerUnitPerPricePointUSD =
    spec.tickValuePerLotUSD / spec.tickSize / spec.contractSize;

  const warnings: LotSizeWarning[] = [];

  const quoteConv = computeQuoteConversion({
    spec,
    entryPrice,
    quoteToAccountRate,
    accountCurrency,
    accountToUsd,
    warnings,
  });

  const riskPerUnitUSD = priceDistance * valuePerUnitPerPricePointUSD * quoteConv;
  if (!Number.isFinite(riskPerUnitUSD) || riskPerUnitUSD <= 0) {
    // Something's off with the rate the user entered — bail instead of
    // producing Infinity/NaN downstream.
    return null;
  }

  const units = riskUSD / riskPerUnitUSD;

  // Round DOWN to broker step (0.01 by default). Brokers reject orders
  // below their minimum step size, and rounding up would exceed the user's
  // intended max-risk. Exposing the raw unrounded value directly caused
  // trades to fail at the broker with "invalid volume" because UI showed
  // e.g. 0.07483921 while the broker only accepts 2dp.
  const LOT_STEP = 0.01;
  // Nudge by an epsilon before flooring: in IEEE-754, 0.2 / 0.01 is
  // 19.999999999999996, so a bare floor returned 0.19 lots for an exact 0.20 —
  // one step light on every size that lands on a round number. The epsilon is
  // far smaller than a lot step, so a genuine 0.194 still floors to 0.19.
  const floorToStep = (value: number): number =>
    Math.round(Math.floor(value / LOT_STEP + 1e-9) * LOT_STEP * 100) / 100;

  const standardLotsRaw = units / spec.contractSize;
  const standardLots = floorToStep(standardLotsRaw);
  const miniLots = floorToStep(standardLotsRaw * 10);
  const microLots = floorToStep(standardLotsRaw * 100);

  // ── Pip value per standard lot (USD + account currency) ────────────────
  const pipValuePerLotUSD =
    spec.pipSize * valuePerUnitPerPricePointUSD * quoteConv * spec.contractSize;
  const pipValuePerLotAccount = pipValuePerLotUSD / accountToUsd;
  const pipsAtRisk =
    spec.pipSize > 0
      ? Math.round((priceDistance / spec.pipSize) * 10) / 10
      : 0;

  // ── Reward / target ────────────────────────────────────────────────────
  const rewardAmount = riskAccount * rewardRatio;
  const targetPrice =
    direction === "buy"
      ? entryPrice + priceDistance * rewardRatio
      : entryPrice - priceDistance * rewardRatio;

  // ── Notional + margin (account currency) ───────────────────────────────
  const notionalUSD = units * entryPrice * quoteConv;
  const notionalAccount = notionalUSD / accountToUsd;

  const marginRequiredAccount =
    leverage && Number.isFinite(leverage) && leverage > 0
      ? notionalAccount / leverage
      : null;

  // ── Warnings ───────────────────────────────────────────────────────────
  if (riskPercent > 2) {
    warnings.push({
      level: "warn",
      message:
        "Risk exceeds 2%. Professional traders typically risk 1–2% per trade.",
    });
  }
  if (marginRequiredAccount !== null && marginRequiredAccount > accountBalance) {
    warnings.push({
      level: "error",
      message: "Margin required exceeds account balance at this leverage",
    });
  }
  if (marginRequiredAccount !== null && marginRequiredAccount > accountBalance * 0.5) {
    warnings.push({
      level: "warn",
      message:
        "Margin uses over 50% of account. A single adverse move can trigger a margin call.",
    });
  }

  return {
    units,
    standardLots,
    miniLots,
    microLots,
    pipValuePerLotUSD,
    pipValuePerLotAccount,
    dollarRisk: riskAccount,
    rewardAmount,
    targetPrice,
    priceDistance,
    pipsAtRisk,
    notionalAccount,
    marginRequiredAccount,
    warnings,
    effectiveSpec: spec,
  };
}

/**
 * Determine whether this instrument's quote currency matches the account's
 * USD-math base, and if not, compute the conversion factor. Pushes a warning
 * when the user needs to supply `quoteToAccountRate` but didn't.
 *
 * Conversion factor semantics:
 *   riskPerUnit_USD = priceDistance × valuePerUnitPerPricePoint_USD × factor
 *
 *   factor = 1                         → XXX/USD direct quote (EURUSD, BTCUSDT, XAUUSD)
 *   factor = 1 / entryPrice            → USD/XXX indirect quote (USDJPY, USDCAD)
 *   factor = quoteToUSDRate            → cross pair (EURGBP → GBPUSD rate)
 */
function computeQuoteConversion(args: {
  readonly spec: InstrumentSpec;
  readonly entryPrice: number;
  readonly quoteToAccountRate: number | undefined;
  readonly accountCurrency: AccountCurrency;
  readonly accountToUsd: number;
  readonly warnings: LotSizeWarning[];
}): number {
  const { spec, entryPrice, quoteToAccountRate, warnings } = args;

  // Non-forex CFDs: the broker already quotes tickValue in USD, so
  // conversion is 1. The user supplies an account-currency rate separately
  // via accountToUsd at the outer scope.
  if (spec.assetClass !== "forex") return 1;

  const quote = spec.quoteCurrency.toUpperCase();
  const base = spec.baseCurrency.toUpperCase();

  // XXX/USD direct.
  if (quote === "USD") return 1;

  // USD/XXX indirect — risk per unit is quoted in XXX, so divide by rate.
  if (base === "USD") {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 1;
    return 1 / entryPrice;
  }

  // Cross pair — resolve via the shared quote→USD table (the same one the P&L
  // math uses, so a position sized here is valued consistently later).
  const conversion = quoteToUsdFactor({
    quoteCurrency: quote,
    baseCurrency: base,
    price: entryPrice,
    explicitRate: quoteToAccountRate,
  });
  if (conversion.approximate) {
    warnings.push({
      level: "info",
      message: `${conversion.note} Enter the current ${quote}/USD rate in the advanced section for an exact lot size.`,
    });
  }
  return conversion.factor;
}

/**
 * Conservative, broker-agnostic FX approximations for account-currency → USD.
 * Used for the P/L display conversion only (internal math stays in USD). A
 * future enhancement could fetch live rates; hard-coded mid-rates are fine
 * for the sizing use case where the user typically eyeballs $/pip anyway.
 */
function accountCcyToUsd(currency: AccountCurrency): number {
  switch (currency) {
    case "USD":
      return 1;
    case "EUR":
      // Conservative ~1.08; user's actual balance is what matters, this is
      // only for the $→account display conversion on pip value.
      return 1.08;
    case "GBP":
      return 1.27;
  }
}
