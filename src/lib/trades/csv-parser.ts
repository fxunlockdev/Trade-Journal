import Papa from "papaparse";
import type { CreateTrade } from "@/types/database";

interface Mt5CsvRow {
  readonly Order?: string;
  readonly Symbol?: string;
  readonly Type?: string;
  readonly Volume?: string;
  readonly "Open Price"?: string;
  readonly "Close Price"?: string;
  readonly "Open Time"?: string;
  readonly "Close Time"?: string;
  readonly Commission?: string;
  readonly Swap?: string;
  readonly Profit?: string;
}

interface ParseError {
  readonly row: number;
  readonly message: string;
}

interface ParseResult {
  readonly trades: readonly CreateTrade[];
  readonly errors: readonly ParseError[];
}

function detectAssetType(
  symbol: string,
): "forex" | "crypto" | "metal" {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("XAU") || upper.startsWith("XAG")) return "metal";
  if (upper.endsWith("USDT") || upper.endsWith("BTC")) return "crypto";
  return "forex";
}

function normalizeDirection(type: string): "buy" | "sell" | null {
  const lower = type.toLowerCase().trim();
  if (lower === "buy" || lower === "buy limit" || lower === "buy stop")
    return "buy";
  if (lower === "sell" || lower === "sell limit" || lower === "sell stop")
    return "sell";
  return null;
}

export function parseCSV(csvContent: string): ParseResult {
  const parsed = Papa.parse<Mt5CsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  const trades: CreateTrade[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 1;

    try {
      const symbol = row.Symbol?.trim();
      if (!symbol) {
        errors.push({ row: rowNumber, message: "Missing Symbol" });
        continue;
      }

      const typeStr = row.Type?.trim();
      if (!typeStr) {
        errors.push({ row: rowNumber, message: "Missing Type" });
        continue;
      }

      const direction = normalizeDirection(typeStr);
      if (!direction) {
        errors.push({
          row: rowNumber,
          message: `Invalid trade type: ${typeStr}`,
        });
        continue;
      }

      const openPrice = parseFloat(row["Open Price"] ?? "");
      const closePrice = parseFloat(row["Close Price"] ?? "");
      const volume = parseFloat(row.Volume ?? "");

      if (isNaN(openPrice) || openPrice <= 0) {
        errors.push({ row: rowNumber, message: "Invalid Open Price" });
        continue;
      }

      if (isNaN(volume) || volume <= 0) {
        errors.push({ row: rowNumber, message: "Invalid Volume" });
        continue;
      }

      const openTime = row["Open Time"]?.trim();
      const closeTime = row["Close Time"]?.trim();

      if (!openTime) {
        errors.push({ row: rowNumber, message: "Missing Open Time" });
        continue;
      }

      const commission = parseFloat(row.Commission ?? "0");
      const swap = parseFloat(row.Swap ?? "0");
      const fees =
        (isNaN(commission) ? 0 : Math.abs(commission)) +
        (isNaN(swap) ? 0 : Math.abs(swap));

      const trade: CreateTrade = {
        user_id: "",
        instrument: symbol.toUpperCase(),
        asset_type: detectAssetType(symbol),
        direction,
        entry_price: openPrice,
        exit_price: isNaN(closePrice) || closePrice <= 0 ? null : closePrice,
        quantity: volume,
        lot_size: volume,
        stop_loss: null,
        take_profit: null,
        fees,
        notes: null,
        tags: ["csv-import"],
        entry_time: openTime,
        exit_time: closeTime || null,
        source: "csv",
      };

      trades.push(trade);
    } catch (err) {
      errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { trades, errors };
}
