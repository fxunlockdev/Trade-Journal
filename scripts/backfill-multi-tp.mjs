/**
 * Recompute exit_price / pnl_absolute / pnl_percentage / r_multiple for
 * MULTI-TARGET manual trades saved before the last-recorded-outcome fix.
 * (risk_reward_ratio is deliberately NOT written — the journal recomputes R:R
 * for display from the highest hit TP, so the stored column isn't shown.)
 *
 * Why: computeMultiTpPnl used to divide a position into `num_positions`
 * slices, which is 1 in Single mode — so only the FIRST recorded TP result
 * (TP1) ever counted. A trade that ran to TP2 was stored with TP1's exit
 * price, TP1's pips and TP1's P&L.
 *
 * Scope: source = 'manual' rows carrying at least one tp*_result. Rows whose
 * stored values already match are left alone, so the pass is idempotent.
 * Broker rows (csv / mt5_webhook) are never touched — their P&L is the
 * broker's real money figure.
 *
 * Dry run (default, writes nothing):
 *   node scripts/backfill-multi-tp.mjs
 * Apply:
 *   node scripts/backfill-multi-tp.mjs --apply
 */

import { createClient } from "@supabase/supabase-js";

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

const TP_KEYS = ["tp1", "tp2", "tp3", "tp4", "tp5", "tp6", "tp7"];

/** Mirrors priceForResult in src/lib/trades/computations.ts. */
function priceForResult(result, tpPrice, entryPrice, stopLoss) {
  if (result === "hit") return tpPrice != null && tpPrice > 0 ? tpPrice : null;
  if (result === "be") return entryPrice;
  return stopLoss != null && stopLoss > 0 ? stopLoss : null;
}

/** Mirrors computeMultiTpPnl in src/lib/trades/computations.ts. */
function computeMultiTp(trade) {
  const slots = TP_KEYS.map((k) => ({
    price: trade[k] == null ? null : Number(trade[k]),
    result: trade[`${k}_result`] ?? null,
  }));
  const concrete = slots.filter((s) => s.result != null);
  if (concrete.length === 0) return null;

  const entry = Number(trade.entry_price);
  const qty = Number(trade.quantity ?? 1);
  const fees = Number(trade.fees ?? 0);
  const sl = trade.stop_loss == null ? null : Number(trade.stop_loss);
  const buy = trade.direction === "buy";

  const isSplit = Boolean(trade.split_risk) && Number(trade.num_positions ?? 1) > 1;

  if (!isSplit) {
    // Single position: banked levels stay banked — the furthest HIT target is
    // the close. A be/sl marked on a later target describes the runner, not the
    // whole position. Falls back to the stop, then break-even. Mirrors
    // singlePositionExit in src/lib/trades/computations.ts.
    let exitPx = null;
    for (const slot of slots) {
      if (slot.result !== "hit") continue;
      const px = slot.price;
      if (px == null || !(px > 0)) continue;
      if (exitPx === null) exitPx = px;
      else exitPx = buy ? Math.max(exitPx, px) : Math.min(exitPx, px);
    }
    if (exitPx == null && slots.some((s) => s.result === "sl")) {
      exitPx = sl != null && sl > 0 ? sl : null;
    }
    if (exitPx == null && slots.some((s) => s.result === "be")) exitPx = entry;
    if (exitPx == null) return null;
    const gross = buy ? (exitPx - entry) * qty : (entry - exitPx) * qty;
    return { value: gross - fees, price: exitPx };
  }

  const slices = Math.max(1, Math.min(10, Number(trade.num_positions)));
  const perSlice = qty / slices;
  let realized = 0, num = 0, den = 0;
  for (let i = 0; i < Math.min(concrete.length, slices); i += 1) {
    const { price, result } = concrete[i];
    const exitPx = priceForResult(result, price, entry, sl);
    if (exitPx == null) continue;
    realized += buy ? (exitPx - entry) * perSlice : (entry - exitPx) * perSlice;
    num += exitPx * perSlice;
    den += perSlice;
  }
  if (den === 0) return null;
  return { value: realized - fees, price: num / den };
}

function round(n) {
  return n == null ? null : Math.round(n * 1e8) / 1e8;
}

async function main() {
  console.log(APPLY ? "APPLY mode — writing changes.\n" : "DRY RUN — nothing will be written. Re-run with --apply to write.\n");

  let offset = 0;
  const PAGE = 500;
  let scanned = 0, changed = 0, skipped = 0, flips = 0;

  for (;;) {
    const { data: trades, error } = await supabase
      .from("trades")
      .select(
        "id, source, direction, entry_price, exit_price, quantity, fees, stop_loss, num_positions, split_risk, pnl_absolute, " +
          TP_KEYS.join(", ") + ", " + TP_KEYS.map((k) => `${k}_result`).join(", "),
      )
      .eq("source", "manual")
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Fetch error:", error.message);
      process.exit(1);
    }
    if (!trades || trades.length === 0) break;

    for (const trade of trades) {
      scanned += 1;

      // Any row with a recorded outcome is in scope. Gating on "2+ TP prices"
      // skipped split rows whose result slots carry no price of their own, and
      // those are exactly the rows whose stored math changed. Rows that already
      // agree are filtered out below by the no-change guard, so a wider net is
      // free.
      const hasResult = TP_KEYS.some((k) => trade[`${k}_result`] != null);
      if (!hasResult) continue;

      const entry = Number(trade.entry_price);
      if (!Number.isFinite(entry) || entry <= 0) { skipped += 1; continue; }

      const multi = computeMultiTp(trade);
      if (multi === null) { skipped += 1; continue; }

      const exit_price = round(multi.price);
      const pnl_absolute = round(multi.value);
      const oldExit = trade.exit_price == null ? null : round(Number(trade.exit_price));
      const oldPnl = trade.pnl_absolute == null ? null : round(Number(trade.pnl_absolute));

      if (oldExit === exit_price && oldPnl === pnl_absolute) continue; // already correct

      const pnl_percentage = round(
        entry === 0
          ? 0
          : trade.direction === "buy"
            ? ((multi.price - entry) / entry) * 100
            : ((entry - multi.price) / entry) * 100,
      );

      const sl = trade.stop_loss == null ? null : Number(trade.stop_loss);
      const risk = sl == null ? null : Math.abs(entry - sl);
      const r_multiple =
        risk == null || risk === 0
          ? null
          : round(
              (trade.direction === "buy" ? multi.price - entry : entry - multi.price) / risk,
            );

      // A sign flip means the trade changes from a win to a loss (or back) —
      // always worth surfacing rather than burying in a list of numbers.
      const flipped =
        oldPnl != null &&
        pnl_absolute != null &&
        Math.sign(oldPnl) !== Math.sign(pnl_absolute);
      if (flipped) flips += 1;

      console.log(
        `  ${trade.id.slice(0, 8)}…  exit ${oldExit} → ${exit_price}   pnl ${oldPnl} → ${pnl_absolute}` +
          (flipped ? "   ⚠ WIN/LOSS FLIPS" : ""),
      );

      if (APPLY) {
        const { error: upErr } = await supabase
          .from("trades")
          .update({ exit_price, pnl_absolute, pnl_percentage, r_multiple })
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
    `\nScanned ${scanned} manual trades. ${changed} ${APPLY ? "updated" : "would change"}, ${skipped} skipped (unresolvable).`,
  );
  if (flips > 0) console.log(`${flips} row(s) change between win and loss — review those before applying.`);
  if (!APPLY && changed > 0) console.log("Re-run with --apply to write these changes.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
