import { describe, expect, it } from "vitest";
import {
  parseTradeIntent,
  draftIsClosed,
  describeDraft,
  type TradeDraft,
} from "@/lib/telegram/trade-intent";

/**
 * The composition of three parsers into the one line a person confirms.
 * NOTHING IS SAVED WITHOUT A PERSON SEEING IT FIRST, so the summary has to be
 * both complete and honest, and the refusals have to name what is missing.
 */

const NOW = new Date("2026-09-03T14:00:00Z");

describe("a complete message", () => {
  it("becomes a draft with every figure a person can check", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348", NOW);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.draft).toMatchObject({
      instrument: "XAUUSD",
      asset_type: "metal",
      direction: "buy",
      entry_price: 3340,
      stop_loss: 3335,
      tp1: 3350,
      outcome: { kind: "closed_at", exit_price: 3348 },
    });
    expect(r.summary).toContain("XAUUSD");
    expect(r.summary).toContain("BUY");
    expect(r.summary).toContain("closed 3348");
    // Gold is 0.1 per pip in instrument-specs, the MT5 convention every poster
    // uses, so 3340 to 3348 is 80 pips. The summary must agree with the image.
    expect(r.summary).toMatch(/\+80[.,]0 pips/);
  });

  it("infers the asset type from the instrument", () => {
    const fx = parseTradeIntent("EURUSD sell 1.0850 sl 1.0880 closed 1.0820", NOW);
    const btc = parseTradeIntent("BTCUSD buy 65000 sl 64500 closed 66000", NOW);
    expect(fx.kind === "ready" && fx.draft.asset_type).toBe("forex");
    expect(btc.kind === "ready" && btc.draft.asset_type).toBe("crypto");
  });

  it("uses the written date, and says so", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 closed 3348 on 28 aug", NOW);
    expect(r.kind === "ready" && r.draft.entry_time.slice(0, 10)).toBe("2026-08-28");
    expect(r.kind === "ready" && r.draft.dated_from_text).toBe(true);
    expect(r.kind === "ready" && r.summary).toContain("2026-08-28");
  });

  it("defaults to now when no date is written, and says today", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 closed 3348", NOW);
    expect(r.kind === "ready" && r.draft.entry_time).toBe(NOW.toISOString());
    expect(r.kind === "ready" && r.summary).toContain("today");
  });

  it("accepts a named result when the price it implies is present", () => {
    const r = parseTradeIntent("GBPUSD sell 1.2700 sl 1.2740 tp1 1.2650 tp1 hit", NOW);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.summary).toContain("TP1 hit");
  });

  it("accepts an open trade but flags it as not countable", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 tp1 3350 still open", NOW);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && draftIsClosed(r.draft)).toBe(false);
  });
});

describe("an incomplete message names what is missing", () => {
  it("asks for the outcome when none was given", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 tp1 3350", NOW);
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/what happened/);
  });

  it("asks for the TP price when a TP was hit but never stated", () => {
    // "tp2 hit" with no tp2 price: the exit cannot be derived.
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 tp2 hit", NOW);
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/TP2 price/);
  });

  it("asks for the stop when stopped out without one", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 stopped out", NOW);
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/stop loss/);
  });

  it("asks for the entry when only a direction is given", () => {
    const r = parseTradeIntent("XAUUSD buy closed 3348", NOW);
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/entry/);
  });
});

describe("chat is not a trade", () => {
  // What lets the bot stay silent for "thanks" instead of answering every DM
  // with a parse error.
  it.each(["thanks", "morning all", "did that post?", ""])("ignores %j", (t) => {
    expect(parseTradeIntent(t, NOW).kind).toBe("not_a_trade");
  });

  it("ignores a number with no instrument or direction", () => {
    expect(parseTradeIntent("see you at 3", NOW).kind).toBe("not_a_trade");
  });
});

describe("entry detection, the way people actually type", () => {
  // The original fallback only understood "buy XAUUSD 3340". Pierre writes
  // "XAUUSD buy 3340". Both must work, and neither may take an outcome verb
  // for a symbol.
  it("reads symbol-first", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3348", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(3340);
  });

  it("reads direction-first", () => {
    const r = parseTradeIntent("buy XAUUSD 3340 sl 3335 closed 3348", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(3340);
  });

  it("does NOT read the exit as the entry", () => {
    // "XAUUSD buy closed 3348": the old fallback took "closed" as the symbol
    // and 3348 as the entry, so the trade's result became its start.
    const r = parseTradeIntent("XAUUSD buy closed 3348", NOW);
    expect(r.kind).toBe("incomplete");
  });

  it("does NOT read 'out at' or 'closed at' as an entry marker", () => {
    const r = parseTradeIntent("BTCUSD long 65000 sl 64500 out at 66000", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(65000);
    expect(r.kind === "ready" && r.draft.outcome).toMatchObject({ exit_price: 66000 });
  });

  it("still honours an explicit @ entry", () => {
    const r = parseTradeIntent("EURUSD sell @ 1.0850 sl 1.0880 closed 1.0820", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(1.085);
  });
});

describe("what the adversarial review found", () => {
  // Each of these was saved by the first version, several of them as a
  // plausible-looking wrong number a person would have tapped through.

  it("refuses two trades in one message instead of blending them", () => {
    const r = parseTradeIntent(
      "XAUUSD buy 3340 closed 3348 and EURUSD sell 1.0850 closed 1.0820",
      NOW,
    );
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/one trade per message/);
  });

  it("does not take a time for the entry", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 at 10:30 closed 3348", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(3340);
  });

  it("reads a stop-out price as the exit, not the entry", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3330 stopped at 3332", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(3340);
    expect(r.kind === "ready" && r.draft.outcome).toMatchObject({ exit_price: 3332 });
    expect(r.kind === "ready" && r.summary).toMatch(/-80[.,]0 pips/);
  });

  it("does not flip a sell into a buy because of 'long day'", () => {
    const r = parseTradeIntent("XAUUSD sell 3340 sl 3345 closed 3335, long day", NOW);
    expect(r.kind).toBe("incomplete");
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/both/);
  });

  it("does not take a pip count as the exit", () => {
    expect(parseTradeIntent("XAUUSD buy 3340 sl 3335 closed +80 pips", NOW).kind).toBe(
      "incomplete",
    );
  });

  it("reads thousands separators as thousands", () => {
    const r = parseTradeIntent("BTCUSD buy 65,000 sl 64,500 closed 66,500", NOW);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(65000);
    expect(r.kind === "ready" && r.draft.outcome).toMatchObject({ exit_price: 66500 });
  });

  it("refuses an exit that cannot be this instrument's price", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3", NOW);
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(
      /doesn't look like a XAUUSD price/,
    );
    const words = parseTradeIntent(
      "XAUUSD buy 3340 sl 3335 tp1 3350, out of 3 trades this was the best",
      NOW,
    );
    expect(words.kind).toBe("incomplete");
  });

  it("refuses a stop on the wrong side, in words rather than a validator message", () => {
    const b = parseTradeIntent("XAUUSD buy 3340 sl 3345 tp1 3350 closed 3348", NOW);
    expect(b.kind === "incomplete" && b.missing.join(" ")).toMatch(/below the entry/);
    const s = parseTradeIntent("XAUUSD sell 3340 sl 3335 closed 3330", NOW);
    expect(s.kind === "incomplete" && s.missing.join(" ")).toMatch(/above the entry/);
  });

  it("reads a typed lot size and shows it", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3348 0.5 lots", NOW);
    expect(r.kind === "ready" && r.draft.quantity).toBe(0.5);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(3340);
    expect(r.kind === "ready" && r.draft.dated_from_text).toBe(false);
    expect(r.kind === "ready" && r.summary).toContain("0.5 lots");
  });

  it("leaves the size to the journal when none was typed", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3348", NOW);
    expect(r.kind === "ready" && r.draft.quantity).toBeNull();
  });

  it("keeps the real date when a price looks like one", () => {
    const r = parseTradeIntent("USOIL buy 65.20 sl 64.80 closed 66.10 on 28/08", NOW);
    expect(r.kind === "ready" && r.draft.entry_time.slice(0, 10)).toBe("2026-08-28");
  });

  it("does not date a trade from a two-decimal price", () => {
    const r = parseTradeIntent("EURUSD buy 1.09 sl 1.08 closed 1.10", NOW);
    expect(r.kind === "ready" && r.draft.dated_from_text).toBe(false);
  });

  it("refuses a date in the future", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3348 on 05/09", NOW);
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/future/);
  });

  it("keeps 'yesterday' as the moment typed minus a day, and says so", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 closed 3348 yesterday", NOW);
    expect(r.kind === "ready" && r.draft.entry_time).toBe(
      new Date(NOW.getTime() - 86_400_000).toISOString(),
    );
    expect(r.kind === "ready" && r.summary).toContain("yesterday");
  });

  it("keeps what was typed with the draft", () => {
    const text = "XAUUSD buy 3340 sl 3335 closed 3348";
    const r = parseTradeIntent(text, NOW);
    expect(r.kind === "ready" && r.draft.message).toBe(text);
  });

  it("accepts an index, which the database now allows", () => {
    const r = parseTradeIntent("US30 buy 41000 sl 40900 closed 41100", NOW);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.draft.asset_type).toBe("index");
  });

  it("says why when two results were written", () => {
    const r = parseTradeIntent("XAUUSD buy 3340 sl 3335 tp1 3350 tp1 hit, stopped out", NOW);
    expect(r.kind === "incomplete" && r.missing.join(" ")).toMatch(/more than one result/);
  });

  it("stays silent for commentary with no entry and no result", () => {
    expect(parseTradeIntent("EURUSD looking bullish above 1.0850", NOW).kind).toBe(
      "not_a_trade",
    );
  });
});

describe("describeDraft", () => {
  const draft = (o: Partial<TradeDraft>): TradeDraft => ({
    instrument: "XAUUSD",
    asset_type: "metal",
    direction: "buy",
    entry_price: 3340,
    entry_price_high: null,
    stop_loss: null,
    tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
    tp4_trailing: false,
    outcome: { kind: "closed_at", exit_price: 3348 },
    entry_time: "2026-09-03T14:00:00.000Z",
    dated_from_text: false,
    date_label: null,
    quantity: null,
    message: "",
    ...o,
  });

  it("signs pips by direction, so a losing sell is not shown as a win", () => {
    expect(
      describeDraft(draft({ direction: "sell", outcome: { kind: "closed_at", exit_price: 3350 } })),
    ).toContain("-100.0 pips");
    expect(
      describeDraft(draft({ direction: "sell", outcome: { kind: "closed_at", exit_price: 3330 } })),
    ).toContain("+100.0 pips");
  });

  it("shows an entry range", () => {
    expect(describeDraft(draft({ entry_price_high: 3345 }))).toContain("entry 3340-3345");
  });

  it.each([
    [{ kind: "result", result: "hit", tpIndex: 2 } as const, "TP2 hit"],
    [{ kind: "result", result: "sl" } as const, "stopped out"],
    [{ kind: "result", result: "be" } as const, "breakeven"],
    [{ kind: "still_open" } as const, "still open"],
  ])("names the outcome %j", (outcome, text) => {
    expect(describeDraft(draft({ outcome }))).toContain(text);
  });

  it("shows the day as typed, else the date, else today", () => {
    expect(describeDraft(draft({ date_label: "yesterday", dated_from_text: true }))).toContain("yesterday");
    expect(describeDraft(draft({ dated_from_text: true }))).toContain("2026-09-03");
    expect(describeDraft(draft({}))).toContain("today");
  });
});

describe("what the red team found in the rewrite", () => {
  it.each([
    ["SELL USD/JPY 150.25 SL 150.80 closed 149.90", "USDJPY", 150.25],
    ["BUY GBP/JPY 190.10 sl 189.50 closed 190.60", "GBPJPY", 190.1],
    ["BUY BTC-USD 65000 sl 64500 closed 66000", "BTCUSD", 65000],
    ["long eur/gbp 0.8450 sl 0.8400 closed 0.8500", "EURGBP", 0.845],
    ["BUY BTC/USDT 65000 sl 64500 closed 66000", "BTCUSDT", 65000],
  ])("reads a symbol typed with separators: %j", (text, instrument, entry) => {
    const r = parseTradeIntent(text, NOW);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.draft.instrument).toBe(instrument);
    expect(r.kind === "ready" && r.draft.entry_price).toBe(entry);
  });

  it("is not fooled by extra whitespace after a closing verb", () => {
    const two = parseTradeIntent("buy 3340 xauusd sl 3330 closed  at 3348", NOW);
    expect(two.kind === "ready" && two.draft.entry_price).toBe(3340);
    expect(two.kind === "ready" && two.draft.outcome).toMatchObject({ exit_price: 3348 });
    const nl = parseTradeIntent("XAUUSD buy 3340 sl 3330\nclosed\n at 3348", NOW);
    expect(nl.kind === "ready" && nl.draft.entry_price).toBe(3340);
  });
});
