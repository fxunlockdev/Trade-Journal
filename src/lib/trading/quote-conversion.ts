/**
 * Quote currency → USD conversion.
 *
 * A price move on any instrument is denominated in its QUOTE currency:
 *   priceMove × units = profit in the quote currency
 * For EURUSD or XAUUSD the quote is already USD, so that figure is dollars.
 * For USDJPY it is YEN — reporting it as dollars overstates the result by the
 * USD/JPY rate (~164×), which is exactly how a 10-pip USDJPY trade came out as
 * "$10.00" instead of "$0.06".
 *
 * One implementation shared by the P&L math and the lot-size calculator, so a
 * position sized on one set of assumptions can't be valued on another.
 */

export interface QuoteConversion {
  /** Multiply a quote-currency amount by this to get USD. */
  readonly factor: number;
  /** True when a hardcoded mid-rate was used instead of a real one. */
  readonly approximate: boolean;
  /** Human-readable note when `approximate` — surfaced next to the number. */
  readonly note?: string;
}

const EXACT: QuoteConversion = { factor: 1, approximate: false };

/**
 * Rough mid-rates for quote currencies we can't derive from the instrument's
 * own price (crosses like EURJPY, XAUJPY). Only reached when the caller has no
 * live rate to pass in; always flagged `approximate` so the UI can say so.
 * Deliberately conservative — a trader eyeballing a cross-pair P&L wants the
 * right order of magnitude, and a wrong-by-2% figure beats a wrong-by-164× one.
 */
const QUOTE_TO_USD_APPROX: Readonly<Record<string, number>> = {
  JPY: 1 / 150,
  CHF: 1.11,
  CAD: 0.74,
  AUD: 0.65,
  NZD: 0.6,
  GBP: 1.27,
  EUR: 1.08,
  SGD: 0.74,
  HKD: 0.13,
  NOK: 0.093,
  SEK: 0.096,
  DKK: 0.145,
  MXN: 0.058,
  ZAR: 0.054,
  TRY: 0.029,
  PLN: 0.25,
  CNH: 0.14,
};

export interface QuoteConversionInput {
  readonly quoteCurrency: string;
  readonly baseCurrency: string;
  /**
   * The instrument's own price. For an indirect quote (USD/XXX — USDJPY,
   * USDCAD) the price IS the quote-per-USD rate, so the conversion is exact.
   * Pass the price that matches what's being valued: the entry when sizing a
   * position, the exit when valuing a realized P&L.
   */
  readonly price: number;
  /** A known quote→USD rate. Wins over everything else when finite and > 0. */
  readonly explicitRate?: number | null;
}

export function quoteToUsdFactor(input: QuoteConversionInput): QuoteConversion {
  const quote = input.quoteCurrency.toUpperCase();
  const base = input.baseCurrency.toUpperCase();

  // Already dollars — the overwhelmingly common case (EURUSD, GBPUSD, XAUUSD,
  // indices, crypto CFDs).
  if (quote === "USD") return EXACT;

  const explicit = input.explicitRate;
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return { factor: explicit, approximate: false };
  }

  // Indirect quote (USD/XXX): the instrument's price is the rate itself, so
  // 1 unit of quote currency = 1/price USD. Exact, no table needed.
  if (base === "USD" && Number.isFinite(input.price) && input.price > 0) {
    return { factor: 1 / input.price, approximate: false };
  }

  const approx = QUOTE_TO_USD_APPROX[quote];
  if (approx !== undefined) {
    return {
      factor: approx,
      approximate: true,
      note: `${quote} converted at an approximate rate of ${approx.toFixed(6)} ${quote}/USD.`,
    };
  }

  // Unknown quote currency: refuse to scale rather than invent a rate. The
  // figure stays in the quote currency, which is at least internally
  // consistent, and the note says so.
  return {
    factor: 1,
    approximate: true,
    note: `No ${quote}/USD rate available, so this figure is in ${quote}, not USD.`,
  };
}
