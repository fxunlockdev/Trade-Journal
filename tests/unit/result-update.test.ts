import { describe, expect, it } from "vitest";
import { parseResultUpdate, hasResult } from "@/lib/telegram/result-update";
import { parseTradeIntent } from "@/lib/telegram/trade-intent";

/**
 * Every message here is verbatim from the four rooms' exports (6,553
 * messages). The reader collects facts; what they mean for the trade is
 * the ingestion's job.
 */

const NOW = new Date("2026-09-05T09:00:00Z");

describe("the signal templates", () => {
  it("reads the Yohan/Chris template", () => {
    const r = parseTradeIntent(
      "🔴 SELL: USD/JPY\n\n📍 ENTRY ZONE : 163.730\n\n🎯 TP1: 163.630 (+10pips)\n🎯 TP2: 163.530 (+20 pips)\n🎯 TP3: 163.430 (+30 pips)\n🎯 FINAL TP: Open\n\n🛑 SL: 163.830 (-10pips)\n\n____________________________\n\nThis is not financial advice,\ntrade at your own risk.",
      NOW,
    );
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.draft).toMatchObject({
      instrument: "USDJPY", direction: "sell", entry_price: 163.73,
      stop_loss: 163.83, tp1: 163.63, tp2: 163.53, tp3: 163.43, tp4_trailing: true,
      outcome: { kind: "unknown" },
    });
  });

  it("reads a BTC entry zone with a range and a dollar sign", () => {
    const r = parseTradeIntent(
      "🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: 64300-64400$\n\n🎯 TP1: 64000 (+400)\n🎯 TP2: 63600 (+800)\n🎯 TP3: 63300 (+1100)\n🎯 FINAL TP: Open\n\n🛑 SL: 65000 (-600)",
      NOW,
    );
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.draft).toMatchObject({
      instrument: "BTCUSD", direction: "sell", entry_price: 64300, entry_price_high: 64400,
      stop_loss: 65000, tp1: 64000, tp2: 63600, tp3: 63300, tp4_trailing: true,
    });
  });

  it("reads the gold intraday template", () => {
    const r = parseTradeIntent(
      "🟢 BUY: XAU/USD\n\n📍 ENTRY ZONE: 4105\n\n🎯 TP1: 4115 (+100 pips)\n🎯 TP2: 4125 (+200 pips)\n🎯 TP3: 4135 (+300 pips)\n🎯 FINAL TP: Open\n\n🛑 SL: 4095 (-100 pips)",
      NOW,
    );
    expect(r.kind === "ready" && r.draft).toMatchObject({ instrument: "XAUUSD", direction: "buy", entry_price: 4105, stop_loss: 4095, tp1: 4115 });
  });

  it("ignores the empty template with xxxxx placeholders", () => {
    const r = parseTradeIntent("🔴 SELL: BTC/USD\n\n📍 ENTRY ZONE: \n\n🎯 TP1: xxxxx (+xxx)\n🎯 TP2: xxxxx (+xxx)\n🛑 SL: xxxxx (-xxx)", NOW);
    expect(r.kind).not.toBe("ready");
  });
});

describe("result replies, verbatim", () => {
  it.each([
    ["🎯 TP1 HIT +10 pips\nYou can protect at BE", [1], false, false, 10],
    ["🎯 TP2 HIT +20 pips !!", [2], false, false, 20],
    ["🛑 SL HIT (-10pips)", [], true, false, -10],
    ["🛑 SL HIT -10pips\nBig announcement…", [], true, false, -10],
    ["Tp1 hits with +110pips✅\n\nBook partial 💰🤑💰", [1], false, false, 110],
    ["Tp 1 hits with +110 pips ✔️\n\nMake trade risk free and book partial if not yet 💰💰", [1], false, false, 110],
    ["Tp3 hits with +240pips✅\n\nTp4 running +300pips🤑💸🤑\n\nBook maximum and trail entry", [3], false, false, 300],
    ["TP1 HIT, +120 PIPS ✅ 🤑\nTP2 HIT, +170 PIPS ✅🤑", [1, 2], false, false, 170],
    ["Tp1 hits with +60pips✅\n\nTp2 hits with +90pips✅\n\nTp3 hits with +140pips✅", [1, 2, 3], false, false, 140],
    ["Lets gooo🚀🚀🚀🚀\n\nTp2 Hits , +130 pips", [2], false, false, 130],
    ["Tp2 hits with +180 pips ✅\n\nKeep trailing SL 💰💰", [2], false, false, 180],
    ["Tp1 hits with +110pips✅\n\nMove SL to 4694\n\nMaking Second entry Risk Free ✅", [1], false, false, 110],
    ["Close first entry at BE✅", [], false, true, null],
    ["Second entry is currently running with +70 pips, Book partial 🤑✅\n\nMove SL to 4336✅\n\nClose first entry at BE✅", [], false, true, 70],
    ["⚡️⚡️⚡️\n➡️ Entry sniper TP1 hit my team ✅🎯", [1], false, false, null],
    ["✅ TP1 HIT (+400 pips)\n✅ TP2 HIT (+700 pips)\n✅ TP3 HIT (+1000 pips)", [1, 2, 3], false, false, 1000],
  ])("%j", (text, hits, stopped, breakeven, pips) => {
    const u = parseResultUpdate(text);
    expect(u.hits).toEqual(hits);
    expect(u.stopped).toBe(stopped);
    expect(u.breakeven).toBe(breakeven);
    expect(u.pips).toBe(pips);
  });

  it("reads Chris's price-before-HIT lines and the in-progress line as not a hit", () => {
    const u = parseResultUpdate("🎯 TP1 64600 HIT (+400 PIPS)\n🎯 TP2 65000 HIT (+800 PIPS)\n⏳ TP3 65400 ( IN PROGRESS )");
    expect(u.hits).toEqual([1, 2]);
    expect(u.running).toBe(true);
    expect(u.pips).toBe(800);
  });

  it("reads a hit named by price only", () => {
    expect(parseResultUpdate("🎯 TP 65200 HIT (+300)").hitPrices).toEqual([65200]);
    expect(parseResultUpdate("🎯 TP HIT (4105) (+100 pips)").hitPrices).toEqual([4105]);
    expect(parseResultUpdate("🎯 TP HIT (4105) (+100 pips)").pips).toBe(100);
  });

  it("reads a target line whose only verb is the positive result", () => {
    const u = parseResultUpdate("🎯 TP3 64000 ( +1000 pips )");
    expect(u.pricedHits).toEqual([{ index: 3, price: 64000, pips: 1000 }]);
    expect(hasResult(u)).toBe(true);
  });

  it("does not take advice for a result", () => {
    for (const t of ["Make trade risk free if you want🤝", "Move SL to 4336✅", "Keep trailing SL 💰💰", "TP4 Floating in +220 pips profit ✅💰", "Trade is running 🏃 +40pips💸💸", "You can protect at BE"]) {
      const u = parseResultUpdate(t);
      expect(hasResult(u)).toBe(false);
    }
    expect(parseResultUpdate("TP4 Floating in +220 pips profit").running).toBe(true);
  });

  it("reads an explicit close", () => {
    expect(parseResultUpdate("closed at 4497 ✅").closedAt).toBe(4497);
    expect(parseResultUpdate("out at 66000, +1200").closedAt).toBe(66000);
  });
});
