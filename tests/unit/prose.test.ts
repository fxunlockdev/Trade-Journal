import { describe, expect, it } from "vitest";
import {
  readExtraction,
  renderCanonical,
  looksLikeProseTrade,
  deriveExit,
  pnlWarnings,
  quoteCurrency,
  statedOnly,
  type Extraction,
} from "@/lib/telegram/prose";
import { parseTradeIntent } from "@/lib/telegram/trade-intent";
import { parseModelJson } from "@/lib/telegram/prose-model";

/**
 * The model translates; this module verifies. Every fixture here is the JSON
 * the model would return for a real message, and the assertions are on what
 * reaches the person: the same intent a typed trade produces, or a refusal
 * in words.
 */

const NOW = new Date("2026-09-04T09:00:00Z");

const base: Extraction = {
  is_trade: true,
  multiple_trades: false,
  instrument: "XAUUSD",
  direction: "buy",
  entry: 3340,
  entry_high: null,
  stop: 3335,
  targets: [3350],
  outcome: { kind: "closed_at", exit: 3348, tp_index: null },
  date: null,
  lots: null,
  pnl: { money: null, currency: null, pips: null, r: null },
  emotion: null,
  notes: null,
};

describe("aliases in the grammar itself", () => {
  it("reads gold, cable and bought without any model", () => {
    const r = parseTradeIntent("bought gold at 3340 sl 3335 closed 3348", NOW);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.draft.instrument).toBe("XAUUSD");
    expect(r.kind === "ready" && r.draft.direction).toBe("buy");
    const c = parseTradeIntent("cable sell 1.2700 sl 1.2740 closed 1.2650", NOW);
    expect(c.kind === "ready" && c.draft.instrument).toBe("GBPUSD");
  });
});

describe("what is worth sending to the model", () => {
  it.each([
    ["Bought gold at 3340 this morning, stop 3335, out at 3348", true],
    ["went long on the nas at 20100, made 80 points", true],
    ["thanks", false],
    ["calm", false],
    ["gold looks bullish", false],
    ["took the dog out at 7", false],
  ])("%j -> %s", (t, yes) => {
    expect(looksLikeProseTrade(t)).toBe(yes);
  });
});

describe("the canonical line", () => {
  it("renders every field the grammar knows, in the grammar's words", () => {
    const line = renderCanonical(
      { ...base, entry_high: 3342, targets: [3350, 3360], lots: 0.5, date: "28 aug" },
      "XAUUSD",
      3348,
    );
    expect(line).toBe("XAUUSD buy 3340-3342 sl 3335 tp1 3350 tp2 3360 closed 3348 0.5 lots on 28 aug");
  });

  it.each([
    [{ kind: "tp_hit", exit: null, tp_index: 2 }, "tp2 hit"],
    [{ kind: "stopped", exit: null, tp_index: null }, "sl hit"],
    [{ kind: "breakeven", exit: null, tp_index: null }, "closed at be"],
    [{ kind: "open", exit: null, tp_index: null }, "still open"],
  ] as const)("renders the outcome %j", (outcome, words) => {
    expect(renderCanonical({ ...base, outcome }, "XAUUSD", null)).toContain(words);
  });

  it("maps day words the date parser does not know", () => {
    expect(renderCanonical({ ...base, date: "this morning" }, "XAUUSD", 3348)).toMatch(/ today$/);
    expect(renderCanonical({ ...base, date: "last night" }, "XAUUSD", 3348)).toMatch(/ yesterday$/);
  });
});

describe("reading an extraction", () => {
  it("produces the same draft a typed trade would, marked as read from prose", () => {
    const r = readExtraction(base, "Bought gold at 3340, stop 3335, target 3350, closed at 3348", NOW);
    expect(r?.intent.kind).toBe("ready");
    if (r?.intent.kind !== "ready") return;
    expect(r.intent.draft).toMatchObject({
      instrument: "XAUUSD",
      direction: "buy",
      entry_price: 3340,
      stop_loss: 3335,
      tp1: 3350,
      outcome: { kind: "closed_at", exit_price: 3348 },
      read_from_prose: true,
      message: "Bought gold at 3340, stop 3335, target 3350, closed at 3348",
    });
    expect(r.intent.summary).toMatch(/\+80[.,]0 pips/);
  });

  it("refuses JSON that is not the schema, and non-trades", () => {
    expect(readExtraction({ garbage: true }, "x", NOW)).toBeNull();
    expect(readExtraction({ ...base, is_trade: false }, "x", NOW)).toBeNull();
  });

  it("refuses two trades and an unknown instrument in words", () => {
    const two = readExtraction({ ...base, multiple_trades: true }, "x", NOW);
    expect(two?.intent.kind === "incomplete" && two.intent.missing.join(" ")).toMatch(/one trade per message/);
    const odd = readExtraction({ ...base, instrument: "TESLA" }, "x", NOW);
    expect(odd?.intent.kind === "incomplete" && odd.intent.missing.join(" ")).toMatch(/instrument I know/);
  });

  it("works the exit out from stated pips, R or dollars when none was given", () => {
    const pips = readExtraction(
      { ...base, outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, pips: 80 } },
      "made 80 pips on gold from 3340",
      NOW,
    );
    expect(pips?.intent.kind === "ready" && pips.intent.draft.outcome).toMatchObject({ exit_price: 3348 });
    expect(pips?.intent.kind === "ready" && pips.intent.summary).toMatch(/from \+80 pips/);

    const r = readExtraction(
      { ...base, outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, r: 2 } },
      "gold long 3340 stop 3335, banked 2R",
      NOW,
    );
    expect(r?.intent.kind === "ready" && r.intent.draft.outcome).toMatchObject({ exit_price: 3350 });

    const money = readExtraction(
      { ...base, lots: 0.5, outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, money: 400 } },
      "gold 0.5 lots from 3340, made $400",
      NOW,
    );
    expect(money?.intent.kind === "ready" && money.intent.draft.outcome).toMatchObject({ exit_price: 3348 });

    const loss = readExtraction(
      { ...base, direction: "sell", stop: 3345, targets: [], outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, pips: -50 } },
      "shorted gold at 3340, lost 50 pips",
      NOW,
    );
    expect(loss?.intent.kind === "ready" && loss.intent.draft.outcome).toMatchObject({ exit_price: 3345 });
  });

  it("asks for what it needs when dollars cannot become a price", () => {
    const noLots = readExtraction(
      { ...base, outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, money: 400 } },
      "made 400 on gold from 3340",
      NOW,
    );
    expect(noLots?.intent.kind === "incomplete" && noLots.intent.missing.join(" ")).toMatch(/size in lots or the exit price/);
    const jpy = readExtraction(
      { ...base, instrument: "USDJPY", entry: 150.2, stop: 149.8, targets: [], lots: 1, outcome: { kind: "unknown", exit: null, tp_index: null }, pnl: { ...base.pnl, money: 300 } },
      "usdjpy long 150.20, 1 lot, made 300 bucks",
      NOW,
    );
    expect(jpy?.intent.kind === "incomplete" && jpy.intent.missing.join(" ")).toMatch(/exit price or the result in pips/);
  });

  it("warns when a stated result disagrees with the prices, rather than picking one", () => {
    const r = readExtraction({ ...base, pnl: { ...base.pnl, pips: 50 } }, "gold 3340 to 3348, +50 pips", NOW);
    expect(r?.intent.kind === "ready" && r.intent.draft.warnings?.join(" ")).toMatch(/you said \+50 pips, but 3340 to 3348 is \+80 pips/);
    expect(r?.intent.kind === "ready" && r.intent.summary).toMatch(/⚠/);
    const fine = readExtraction({ ...base, pnl: { ...base.pnl, pips: 80 } }, "x", NOW);
    expect(fine?.intent.kind === "ready" && fine.intent.draft.warnings).toEqual([]);
  });

  it("prefills the mood and the note the prose gave", () => {
    const r = readExtraction({ ...base, emotion: "anxious", notes: "chased it after news" }, "x", NOW);
    expect(r?.prefill).toEqual({ emotion: "anxious", notes: "chased it after news" });
    const bad = readExtraction({ ...base, emotion: "meh" }, "x", NOW);
    expect(bad?.prefill).toEqual({});
  });

  it("still refuses what the grammar refuses: a stop on the wrong side", () => {
    const r = readExtraction({ ...base, stop: 3345 }, "x", NOW);
    expect(r?.intent.kind === "incomplete" && r.intent.missing.join(" ")).toMatch(/below the entry/);
  });
});

describe("helpers", () => {
  it("knows what a symbol is quoted in", () => {
    expect(quoteCurrency("XAUUSD")).toBe("USD");
    expect(quoteCurrency("USDJPY")).toBe("JPY");
    expect(quoteCurrency("GER40")).toBe("EUR");
    expect(quoteCurrency("BTCUSDT")).toBe("USD");
    expect(quoteCurrency("WHATEVER")).toBeNull();
  });

  it("derives and checks with the instrument's pip size", () => {
    expect(deriveExit({ ...base, pnl: { ...base.pnl, pips: 80 } }, "XAUUSD", "buy", 3340)).toEqual({ exit: 3348, from: "+80 pips" });
    expect(deriveExit({ ...base, pnl: { ...base.pnl, pips: 30 } }, "EURUSD", "sell", 1.085)).toEqual({ exit: 1.082, from: "+30 pips" });
    expect(pnlWarnings({ ...base, pnl: { ...base.pnl, r: 1.6 } }, "XAUUSD", "buy", 3340, 3348)).toEqual([]);
  });
});

describe("the model's reply as text", () => {
  it("finds the JSON with or without fences, and refuses junk", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(parseModelJson("Sure! {\"a\":1} hope that helps")).toEqual({ a: 1 });
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson("")).toBeNull();
    expect(parseModelJson("{broken")).toBeNull();
  });
});

describe("a result the model made up", () => {
  const live = "bought gold at 3340 this morning, stop 3335, closed at 3348 on half a lot";

  it("is discarded when the message never stated one, so no warning appears", () => {
    // The production case: the model reported pips: 8 (3348 - 3340) for a
    // message with no result in words, and the check flagged it against 80.
    const r = readExtraction({ ...base, lots: 0.5, pnl: { ...base.pnl, pips: 8 } }, live, NOW);
    expect(r?.intent.kind).toBe("ready");
    expect(r?.intent.kind === "ready" && r.intent.draft.warnings).toEqual([]);
    expect(r?.intent.kind === "ready" && r.intent.summary).not.toMatch(/⚠/);
  });

  it("is kept when the words are there", () => {
    expect(statedOnly({ ...base, pnl: { ...base.pnl, pips: 80 } }, "gold 3340 to 3348, made 80 pips").pnl.pips).toBe(80);
    expect(statedOnly({ ...base, pnl: { ...base.pnl, r: 2 } }, "banked 2R on gold").pnl.r).toBe(2);
    expect(statedOnly({ ...base, pnl: { ...base.pnl, money: 400, currency: "USD" } }, "made $400 on gold").pnl.money).toBe(400);
    expect(statedOnly({ ...base, pnl: { ...base.pnl, money: -150 } }, "lost 150 on gold").pnl.money).toBe(-150);
  });

  it("is dropped field by field", () => {
    const g = statedOnly({ ...base, pnl: { pips: 80, r: 1.6, money: 400, currency: "USD" } }, "made 80 pips on gold");
    expect(g.pnl).toEqual({ pips: 80, r: null, money: null, currency: null });
  });
});
