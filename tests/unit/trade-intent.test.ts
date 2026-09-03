import { describe, expect, it } from "vitest";
import { parseTradeIntent, draftIsClosed } from "@/lib/telegram/trade-intent";

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
