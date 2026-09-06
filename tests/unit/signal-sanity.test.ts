import { describe, expect, it } from "vitest";
import { parseTradeIntent } from "@/lib/telegram/trade-intent";
import { signalSanity } from "@/lib/telegram/signal-sanity";

/** The proportions a real signal has, and what a slipped digit does to them. */
const draft = (text: string) => {
  const i = parseTradeIntent(text, new Date("2026-09-04T14:00:00Z"));
  if (i.kind !== "ready") throw new Error(`fixture not ready: ${text}`);
  return i.draft;
};

describe("signal sanity", () => {
  it("is quiet for the four rooms' real templates", () => {
    expect(signalSanity(draft("🔵BUY XAUUSD\nENTRY: 4374\nSL: 4360\nTP1: 4380\nTP2: 4385\nTP3: 4390\nTP4: open"), { recentEntries: [4370, 4381] })).toEqual([]);
    expect(signalSanity(draft("🔴 SELL: USD/JPY\n📍 ENTRY ZONE : 163.730\n🎯 TP1: 163.630\n🎯 TP2: 163.530\n🎯 TP3: 163.430\n🎯 FINAL TP: Open\n🛑 SL: 163.830"), { recentEntries: [] })).toEqual([]);
    expect(signalSanity(draft("🔴 SELL: BTC/USD\n📍 ENTRY ZONE: 64300-64400$\n🎯 TP1: 64000\n🎯 TP2: 63600\n🎯 TP3: 63300\n🛑 SL: 65000"), { recentEntries: [60000] })).toEqual([]);
  });

  it("allows crypto to drift further from the room's recent entries than metals or forex", () => {
    const btc = draft("🔴 SELL: BTC/USD\n📍 ENTRY ZONE: 64300\n🎯 TP1: 64000\n🛑 SL: 65000");
    expect(signalSanity(btc, { recentEntries: [54000, 55000, 53000] })).toEqual([]);
    expect(signalSanity(btc, { recentEntries: [40000, 41000, 39000] })).toHaveLength(1);
    const gold = draft("buy xauusd 4374 sl 4360 tp1 4380");
    expect(signalSanity(gold, { recentEntries: [3700, 3710, 3690] })).toHaveLength(1);
    expect(signalSanity(gold, { recentEntries: [3900, 3910, 3890] })).toEqual([]);
    // Two old entries are not a level.
    expect(signalSanity(gold, { recentEntries: [3700, 3710] })).toEqual([]);
  });

  it("names each thing wrong, and only those", () => {
    const issues = signalSanity(draft("buy xauusd 4374 sl 4230 tp1 4380 tp2 4378 tp3 4835"), { recentEntries: [] });
    expect(issues).toEqual([
      "TP3 4835 is 10.5% from the entry; a mistyped digit?",
      "the stop is 24× further from the entry than TP1",
      "targets are out of order: TP2 4378 is not beyond TP1 4380",
    ]);
  });
});
