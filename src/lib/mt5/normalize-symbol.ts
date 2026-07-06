import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";
import type { AssetType } from "@/types/database";

/**
 * Broker MT5 symbols carry decorations the journal shouldn't store:
 * "EURUSD.r", "XAUUSDm", "US30.cash", "GBPUSD-ECN". Normalization lives
 * server-side so a rule fix never requires users to recompile their EA.
 *
 * Resolution order:
 *   1. uppercase + trim; exact match against known instruments → done
 *   2. strip at the first separator (. _ - #) and retry the exact match
 *   3. longest known instrument that is a PREFIX of the symbol (XAUUSDm)
 *   4. fallback: keep the stripped string (getInstrumentSpec builds a sane
 *      fallback spec for unknown symbols anyway)
 */

const KNOWN = new Set<string>(ALL_INSTRUMENTS);

// Longest-first so "XAUUSD" wins over shorter accidental prefixes.
const KNOWN_BY_LENGTH: readonly string[] = [...ALL_INSTRUMENTS].sort(
  (a, b) => b.length - a.length,
);

export interface NormalizedSymbol {
  readonly instrument: string;
  readonly assetType: AssetType;
}

export function normalizeMt5Symbol(rawSymbol: string): NormalizedSymbol {
  const upper = rawSymbol.trim().toUpperCase();

  let candidate = upper;
  if (!KNOWN.has(candidate)) {
    const separatorIndex = candidate.search(/[._\-#]/);
    if (separatorIndex > 0) candidate = candidate.slice(0, separatorIndex);
  }

  if (!KNOWN.has(candidate)) {
    const prefixMatch = KNOWN_BY_LENGTH.find(
      (known) => candidate.startsWith(known) && known.length >= 4,
    );
    if (prefixMatch) candidate = prefixMatch;
  }

  // AssetClass and AssetType are the same string union ("forex" | "crypto" |
  // "metal" | "commodity" | "index") — identity mapping, forex fallback.
  const spec = getInstrumentSpec(candidate);
  return { instrument: candidate, assetType: spec.assetClass };
}
