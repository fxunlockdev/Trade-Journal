/**
 * Re-value manual trades whose P&L was stored in the instrument's QUOTE
 * currency instead of the account currency.
 *
 * `priceMove × quantity` is denominated in the quote currency. For a USD-quoted
 * symbol (EURUSD, GBPUSD, XAUUSD) that's already dollars, so those rows were
 * always right. For a JPY-quoted symbol it was YEN reported as dollars — a
 * 10-pip USDJPY trade stored $10.00 when it was 10 JPY ≈ $0.06.
 *
 * This script imports the REAL `computeTradeFields`, so there is no second copy
 * of the money math to drift out of sync with the app.
 *
 * Scope: source = 'manual' only. Broker rows (csv / mt5_webhook) carry the
 * broker's own realized money and are never touched.
 *
 * Dry run (default, writes nothing):
 *   npx tsx --env-file=.env.local scripts/backfill-pnl-currency.ts
 * Apply:
 *   npx tsx --env-file=.env.local scripts/backfill-pnl-currency.ts --apply
 *
 * (--env-file loads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; drop
 * it if those are already exported in your shell.)
 */

import { createClient } from "@supabase/supabase-js";
import { computeTradeFields } from "@/lib/trades/computations";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const round = (n: number | null): number | null =>
  n == null ? null : Math.round(n * 1e8) / 1e8;

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "APPLY mode — writing changes.\n"
      : "DRY RUN — nothing will be written. Re-run with --apply to write.\n",
  );

  let offset = 0;
  const PAGE = 500;
  let scanned = 0;
  let changed = 0;
  let skipped = 0;

  for (;;) {
    const { data: trades, error } = await supabase
      .from("trades")
      .select("*")
      .eq("source", "manual")
      .not("pnl_absolute", "is", null)
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Fetch error:", error.message);
      process.exit(1);
    }
    if (!trades || trades.length === 0) break;

    for (const trade of trades) {
      scanned += 1;

      // USD-quoted symbols were never mis-valued; skip them entirely so the
      // pass can't churn rows it has no business touching.
      const spec = getInstrumentSpec(String(trade.instrument ?? ""));
      if (spec.quoteCurrency.toUpperCase() === "USD") continue;

      const computed = computeTradeFields(trade);
      const next = round(computed.pnl_absolute);
      const prev = round(
        trade.pnl_absolute == null ? null : Number(trade.pnl_absolute),
      );
      if (next == null) {
        skipped += 1;
        continue;
      }
      if (prev === next) continue; // already correct

      console.log(
        `  ${String(trade.id).slice(0, 8)}…  ${trade.instrument}` +
          `  pnl ${prev} → ${next}` +
          `  (${spec.quoteCurrency} → account ccy)`,
      );

      if (APPLY) {
        const { error: upErr } = await supabase
          .from("trades")
          .update({
            pnl_absolute: next,
            pnl_percentage: round(computed.pnl_percentage),
            r_multiple: round(computed.r_multiple),
          })
          .eq("id", trade.id);
        if (upErr) {
          console.error(`    update failed: ${upErr.message}`);
          continue;
        }
      }
      changed += 1;
    }

    if (trades.length < PAGE) break;
    offset += PAGE;
  }

  console.log(
    `\nScanned ${scanned} manual trades. ${changed} ${
      APPLY ? "updated" : "would change"
    }, ${skipped} skipped (unresolvable).`,
  );
  if (!APPLY && changed > 0) {
    console.log("Re-run with --apply to write these changes.");
  }
}

main().catch((err: unknown) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
