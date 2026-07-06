import { createHash } from "crypto";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import { normalizeMt5Symbol } from "@/lib/mt5/normalize-symbol";
import type { Mt5Event } from "@/lib/validators/mt5";
import type {
  MyfxbookHistoryRow,
  MyfxbookOpenTradeRow,
  MyfxbookSizing,
} from "@/lib/myfxbook/client";

/**
 * Pure Myfxbook-row → Mt5Event mapping. Kept I/O-free so the whole layer is
 * exercised from a node spot-check script (same policy as the EA mapper).
 *
 * The hard problem: Myfxbook's API exposes NO broker ticket. We derive a
 * deterministic 52-bit "ticket" from fields that are identical between an
 * open-trades row and the history row it later becomes:
 *   (account | symbol | direction | openTime | lots | openPrice)
 * - direction (not raw `action`): history reports "Buy Limit" where
 *   open-trades reported "Buy" — normalizing to buy/sell keeps the key stable.
 * - 52 bits: exactly representable in a JS number (< 2^53) AND fits the
 *   existing Postgres bigint column, so the trades_mt5_dedupe index and the
 *   shared ingest work unchanged. Collisions require two trades on the same
 *   account/symbol/side in the same MINUTE at the same size and price —
 *   documented v1 limitation.
 */

const TRADE_ACTIONS = new Set([
  "buy",
  "sell",
  "buy limit",
  "sell limit",
  "buy stop",
  "sell stop",
]);

/** True for actual trades (filters Deposit / Withdrawal / unknown rows). */
export function isTradeAction(action: string | undefined): boolean {
  return Boolean(action && TRADE_ACTIONS.has(action.trim().toLowerCase()));
}

export function actionDirection(action: string): "buy" | "sell" {
  return action.trim().toLowerCase().startsWith("sell") ? "sell" : "buy";
}

/**
 * Volume in LOTS. Myfxbook `sizing` is `{type: "lots"|"units", value: "0.04"}`
 * (units = OANDA-style). The shared ingest multiplies lots × contractSize, so
 * unit-sized accounts are converted to fractional lots here.
 */
export function sizingToLots(sizing: MyfxbookSizing, symbol: string): number {
  const value = Number(sizing?.value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if ((sizing.type ?? "lots").toLowerCase() === "units") {
    const spec = getInstrumentSpec(normalizeMt5Symbol(symbol).instrument);
    return spec.contractSize > 0 ? value / spec.contractSize : value;
  }
  return value;
}

/**
 * "MM/dd/yyyy HH:mm" (broker-local) → unix seconds UTC.
 * brokerUtcOffsetMinutes: broker time = UTC + offset → UTC = broker − offset.
 * Returns null on malformed input.
 */
export function brokerTimeToUnix(
  time: string,
  brokerUtcOffsetMinutes: number,
): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(time?.trim() ?? "");
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  const utcMs =
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)) -
    brokerUtcOffsetMinutes * 60_000;
  return Math.floor(utcMs / 1000);
}

/**
 * Deterministic 52-bit ticket from the open-stable identity fields.
 * Uses RAW openTime string (pre-timezone-conversion) so an offset edit never
 * re-keys existing trades. Prices/lots canonicalized via Number() to survive
 * "0.04" vs "0.040" formatting drift.
 */
export function deriveTicket(
  myfxbookAccountId: string,
  symbol: string,
  direction: "buy" | "sell",
  openTimeRaw: string,
  lots: number,
  openPrice: number,
): number {
  const key = [
    myfxbookAccountId,
    symbol.trim().toUpperCase(),
    direction,
    openTimeRaw.trim(),
    String(Number(lots.toFixed(4))),
    String(Number(openPrice)),
  ].join("|");
  const digest = createHash("sha256").update(key, "utf8").digest();
  const hi = digest.readUInt32BE(0) & 0x000f_ffff; // 20 bits
  const lo = digest.readUInt32BE(4); // 32 bits
  return hi * 0x1_0000_0000 + lo; // 52-bit integer — exact in JS numbers
}

export function mapOpenTrade(
  row: MyfxbookOpenTradeRow,
  myfxbookAccountId: string,
  brokerUtcOffsetMinutes: number,
): Mt5Event | null {
  if (!isTradeAction(row.action) || !row.symbol) return null;
  const openTime = brokerTimeToUnix(row.openTime, brokerUtcOffsetMinutes);
  if (openTime === null) return null;
  const direction = actionDirection(row.action);
  const lots = sizingToLots(row.sizing, row.symbol);
  if (lots <= 0 || !(row.openPrice > 0)) return null;

  return {
    type: "open",
    ticket: deriveTicket(
      myfxbookAccountId,
      row.symbol,
      direction,
      row.openTime,
      lots,
      row.openPrice,
    ),
    symbol: row.symbol,
    direction,
    volume: lots,
    entry_price: row.openPrice,
    sl: row.sl > 0 ? row.sl : null,
    tp: row.tp > 0 ? row.tp : null,
    open_time: openTime,
  };
}

export function mapHistoryRow(
  row: MyfxbookHistoryRow,
  myfxbookAccountId: string,
  brokerUtcOffsetMinutes: number,
): Mt5Event | null {
  if (!isTradeAction(row.action) || !row.symbol) return null;
  const openTime = brokerTimeToUnix(row.openTime, brokerUtcOffsetMinutes);
  const closeTime = brokerTimeToUnix(row.closeTime, brokerUtcOffsetMinutes);
  if (openTime === null || closeTime === null) return null;
  const direction = actionDirection(row.action);
  const lots = sizingToLots(row.sizing, row.symbol);
  if (lots <= 0 || !(row.openPrice > 0) || !(row.closePrice > 0)) return null;

  return {
    type: "close",
    ticket: deriveTicket(
      myfxbookAccountId,
      row.symbol,
      direction,
      row.openTime,
      lots,
      row.openPrice,
    ),
    symbol: row.symbol,
    direction,
    volume: lots,
    entry_price: row.openPrice,
    sl: row.sl > 0 ? row.sl : null,
    tp: row.tp > 0 ? row.tp : null,
    open_time: openTime,
    exit_price: row.closePrice,
    close_time: closeTime,
    profit: Number.isFinite(row.profit) ? row.profit : 0,
    commission: Number.isFinite(row.commission) ? row.commission : 0,
    // Myfxbook calls swap "interest" on history rows.
    swap: Number.isFinite(row.interest) ? row.interest : 0,
    is_final: true,
  };
}
