/**
 * Backfill pnl_absolute, pnl_percentage, r_multiple for trades that have
 * exit_price set but pnl_absolute = null.
 *
 * Run:  node scripts/backfill-pnl.mjs
 *
 * NOTE: the copy of the P&L math below is quote-currency naive — it would
 * report a JPY-quoted trade's yen profit as dollars. Rather than maintain a
 * second implementation, this script now SKIPS any symbol that isn't
 * USD-quoted; use `npx tsx scripts/backfill-pnl-currency.ts` for those, which
 * imports the app's real computeTradeFields.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function computePnlAbsolute(entryPrice, exitPrice, quantity, direction, fees) {
  const rawPnl =
    direction === "buy"
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
  return rawPnl - fees;
}

function computePnlPercentage(entryPrice, exitPrice, direction) {
  if (entryPrice === 0) return 0;
  return direction === "buy"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
}

function computeRMultiple(entryPrice, exitPrice, stopLoss, direction) {
  if (stopLoss == null) return null;
  const risk =
    direction === "buy"
      ? Math.abs(entryPrice - stopLoss)
      : Math.abs(stopLoss - entryPrice);
  if (risk === 0) return null;
  const actualPnl =
    direction === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return actualPnl / risk;
}

async function main() {
  console.log("Fetching trades with exit_price set but pnl_absolute null…");

  // Fetch in batches
  let offset = 0;
  const PAGE = 500;
  let updated = 0;
  let skipped = 0;

  while (true) {
    const { data: trades, error } = await supabase
      .from("trades")
      .select("id, instrument, entry_price, exit_price, quantity, direction, fees, stop_loss, pnl_absolute")
      .not("exit_price", "is", null)
      .is("pnl_absolute", null)
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Fetch error:", error.message);
      process.exit(1);
    }

    if (!trades || trades.length === 0) break;

    console.log(`Processing batch of ${trades.length} trades (offset ${offset})…`);

    for (const trade of trades) {
      const ep = Number(trade.entry_price);
      const xp = Number(trade.exit_price);
      const qty = Number(trade.quantity ?? 1);
      const fees = Number(trade.fees ?? 0);

      if (!Number.isFinite(ep) || !Number.isFinite(xp) || ep <= 0 || xp <= 0) {
        console.warn(`  Skipping trade ${trade.id}: invalid prices (entry=${ep} exit=${xp})`);
        skipped++;
        continue;
      }

      // Only USD-quoted symbols: the math below yields quote-currency profit,
      // so anything else would be written as dollars when it isn't. Those rows
      // belong to scripts/backfill-pnl-currency.ts.
      const symbol = String(trade.instrument ?? "").toUpperCase();
      if (!symbol.endsWith("USD") && !symbol.endsWith("USDT")) {
        console.warn(
          `  Skipping ${trade.id} (${symbol}): not USD-quoted — use scripts/backfill-pnl-currency.ts`,
        );
        skipped++;
        continue;
      }

      const pnl_absolute = computePnlAbsolute(ep, xp, qty, trade.direction, fees);
      const pnl_percentage = computePnlPercentage(ep, xp, trade.direction);
      const r_multiple = computeRMultiple(ep, xp, trade.stop_loss, trade.direction);

      const { error: updateErr } = await supabase
        .from("trades")
        .update({ pnl_absolute, pnl_percentage, r_multiple })
        .eq("id", trade.id);

      if (updateErr) {
        console.error(`  Update failed for trade ${trade.id}:`, updateErr.message);
      } else {
        updated++;
        const sign = pnl_absolute >= 0 ? "+" : "";
        console.log(`  ✓ ${trade.id.slice(0, 8)}… → pnl=${sign}${pnl_absolute.toFixed(2)}`);
      }
    }

    if (trades.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
