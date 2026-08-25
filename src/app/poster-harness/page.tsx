import { notFound } from "next/navigation";
import { PostersClient } from "@/components/posters/posters-client";
import type { Trade } from "@/types/database";

/**
 * Deterministic poster harness — DEVELOPMENT ONLY.
 *
 * The real /posters page is auth-gated and its numbers depend on live trades,
 * neither of which an automated rendering check can rely on. This route mounts
 * the same client component against fixed trades so E2E can verify the part
 * that genuinely can break: that a poster rasterises to a real 1080×1080 PNG
 * with visible type, rather than a blank square (the failure mode when a web
 * font doesn't load or `background-clip: text` isn't honoured).
 *
 * `notFound()` in production keeps it out of the shipped app entirely.
 */
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;

/**
 * Trades anchored to "now" so they always land in Today / This Week / This
 * Month regardless of when the suite runs. Values are chosen so the expected
 * stats are hand-checkable: 4 closed trades, 3 wins / 1 loss, +130 net pips.
 */
function seedTrades(): Trade[] {
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();

  const base = {
    asset_type: "forex",
    quantity: 10_000,
    fees: 0,
    num_positions: 1,
    split_risk: false,
    tp1: null,
    tp1_result: null,
    source: "manual",
  };

  return [
    {
      ...base,
      id: "seed-1",
      instrument: "EURUSD",
      direction: "buy",
      entry_price: 1.1,
      exit_price: 1.106, // +60 pips
      stop_loss: 1.097,
      pnl_absolute: 60,
      r_multiple: 2,
      entry_time: at(6),
      exit_time: at(5),
    },
    {
      ...base,
      id: "seed-2",
      instrument: "EURUSD",
      direction: "sell",
      entry_price: 1.108,
      exit_price: 1.104, // +40 pips
      stop_loss: 1.111,
      pnl_absolute: 40,
      r_multiple: 1.3,
      entry_time: at(5),
      exit_time: at(4),
    },
    {
      ...base,
      id: "seed-3",
      instrument: "GBPUSD",
      direction: "buy",
      entry_price: 1.27,
      exit_price: 1.2650, // -50 pips
      stop_loss: 1.2645,
      pnl_absolute: -50,
      r_multiple: -0.9,
      entry_time: at(4),
      // No exit_time on purpose: exercises the entry-date fallback and the
      // "close time unknown" caveat in the receipt.
      exit_time: null,
    },
    {
      ...base,
      id: "seed-4",
      instrument: "XAUUSD",
      direction: "buy",
      entry_price: 2400,
      exit_price: 2408, // +80 pips at 0.1 pip size
      stop_loss: 2396,
      pnl_absolute: 80,
      r_multiple: 2,
      entry_time: at(3),
      exit_time: at(2),
    },
  ] as unknown as Trade[];
}

/**
 * A larger, messier set covering the paths the default seed can't reach: the
 * dense trade-log layout, the 20-row truncation note, breakeven trades, and a
 * trade with no r_multiple (so Avg R has partial coverage).
 */
function seedDenseTrades(): Trade[] {
  const now = Date.now();
  const base = {
    asset_type: "forex",
    quantity: 10_000,
    fees: 0,
    num_positions: 1,
    split_risk: false,
    tp1: null,
    tp1_result: null,
    source: "manual",
    instrument: "EURUSD",
    direction: "buy",
    stop_loss: 1.097,
  };

  // 22 trades: 14 wins, 6 losses, 2 breakevens. Fractional pips on purpose, so
  // the log column has to reconcile with the rounded headline.
  return Array.from({ length: 22 }, (_, i) => {
    const isBe = i === 5 || i === 11;
    const isLoss = !isBe && i % 3 === 1;
    const move = isBe ? 0 : isLoss ? -0.00312 : 0.001049;
    const at = new Date(now - (22 - i) * 10 * 60 * 1000).toISOString();
    return {
      ...base,
      id: `dense-${i}`,
      entry_price: 1.1,
      exit_price: 1.1 + move,
      pnl_absolute: isBe ? 0 : isLoss ? -31.2 : 10.49,
      // One trade has no stop, so Avg R covers 21 of 22.
      r_multiple: i === 3 ? null : isBe ? 0 : isLoss ? -1 : 0.34,
      entry_time: at,
      exit_time: at,
    };
  }) as unknown as Trade[];
}

export default async function PosterHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly seed?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { seed } = await searchParams;
  const trades = seed === "dense" ? seedDenseTrades() : seedTrades();

  return (
    <PostersClient
      trades={trades}
      journalId="harness"
      journalName="TTC GOLD | YOHAN"
      loadError={null}
    />
  );
}
