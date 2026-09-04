import { describe, expect, it } from "vitest";
import {
  parseOutcome,
  outcomeFields,
  isClosedOutcome,
} from "@/lib/trades/outcome-parser";

/**
 * This decides whether an ingested trade is countable at all: the posters read
 * only closed trades with a P&L, so a trade whose outcome was missed is
 * invisible to the reporting this exists to feed.
 *
 * The refusals matter as much as the matches. An invented outcome gets
 * published to partners, so "unknown" must mean ask, never assume.
 */

describe("an explicit exit price", () => {
  it.each([
    ["XAUUSD buy 3340 sl 3335 closed 3348", 3348],
    ["closed @ 3348", 3348],
    ["exit 1.0850", 1.085],
    ["exited at 1.0850", 1.085],
    ["out at 66000", 66000],
    ["EURUSD sell 1,0850 sl 1,0880 closed 1,0820", 1.082],
  ])("reads %j", (text, price) => {
    const o = parseOutcome(text);
    expect(o).toMatchObject({ kind: "closed_at", exit_price: price });
  });

  it("beats a named result, because a price is exact", () => {
    // "tp1 hit, closed 3348" — the number is the better answer.
    expect(parseOutcome("tp1 hit, closed 3348")).toMatchObject({
      kind: "closed_at",
      exit_price: 3348,
    });
  });

  it("requires a verb, so a bare price is not an exit", () => {
    // THE failure that would matter: swallowing the entry or a target as an
    // exit and publishing a fabricated result.
    expect(parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350").kind).toBe("unknown");
  });

  it("does not read the stop as an exit", () => {
    expect(parseOutcome("buy 3340 sl 3335").kind).toBe("unknown");
  });
});

describe("a named result", () => {
  it.each([
    ["tp1 hit", 1],
    ["hit tp2", 2],
    ["tp3 reached", 3],
    ["took tp1", 1],
    ["TP2 done", 2],
  ])("reads %j as a hit on the right target", (text, index) => {
    expect(parseOutcome(text)).toMatchObject({
      kind: "result",
      result: "hit",
      tpIndex: index,
    });
  });

  it.each(["stopped", "stopped out", "sl hit", "hit sl", "stop hit", "took the loss"])(
    "reads %j as a stop",
    (text) => {
      expect(parseOutcome(text)).toMatchObject({ kind: "result", result: "sl" });
    },
  );

  it.each(["be", "breakeven", "break even", "scratched"])(
    "reads %j as breakeven",
    (text) => {
      expect(parseOutcome(text)).toMatchObject({ kind: "result", result: "be" });
    },
  );

  it("treats 'sl moved to be' as flat, not a loss", () => {
    // Mentions a stop but describes a scratch. Getting this backwards turns a
    // flat trade into a published loss.
    expect(parseOutcome("tp1 missed, sl moved to be")).toMatchObject({
      result: "be",
    });
  });

  it("reads a win even when the stop is mentioned", () => {
    expect(parseOutcome("tp2 hit, sl was at 3335")).toMatchObject({
      result: "hit",
      tpIndex: 2,
    });
  });

  it("does not read the planned stop as a stop-out", () => {
    // "sl 3335" is the plan. Reading it as the verdict would publish a loss
    // for every trade that merely had a stop.
    expect(parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350").kind).toBe("unknown");
    expect(parseOutcome("sl: 1.0880").kind).toBe("unknown");
    expect(parseOutcome("stop @ 190.50").kind).toBe("unknown");
  });
});

describe("open and unknown", () => {
  it.each(["still open", "running", "open trade"])("reads %j as open", (t) => {
    expect(parseOutcome(t).kind).toBe("still_open");
  });

  it("is unknown for an empty or unrelated message", () => {
    expect(parseOutcome("").kind).toBe("unknown");
    expect(parseOutcome("morning all").kind).toBe("unknown");
  });
});

describe("outcomeFields", () => {
  it("writes an exit price and no tp result", () => {
    // A "closed at" already has a real exit. Setting a tp result would flip
    // computeTradeFields into deriving the exit from the TP price instead.
    const f = outcomeFields({ kind: "closed_at", exit_price: 3348 });
    expect(f).toEqual({ exit_price: 3348 });
  });

  it("writes the result on the slot it refers to", () => {
    expect(outcomeFields({ kind: "result", result: "hit", tpIndex: 3 })).toEqual({
      tp3_result: "hit",
    });
  });

  it("marks every priced target up to the one hit, given the prices", () => {
    expect(outcomeFields({ kind: "result", result: "hit", tpIndex: 3 }, [4487, 4492, 4497, null, null, null, null])).toEqual({
      tp1_result: "hit",
      tp2_result: "hit",
      tp3_result: "hit",
    });
    expect(outcomeFields({ kind: "result", result: "hit", tpIndex: 2 }, [4487, null, 4497, null, null, null, null])).toEqual({
      tp1_result: "hit",
    });
  });

  it("records a stop and a breakeven on tp1", () => {
    // The trade's verdict, not a statement about the second target.
    expect(outcomeFields({ kind: "result", result: "sl" })).toEqual({
      tp1_result: "sl",
    });
    expect(outcomeFields({ kind: "result", result: "be" })).toEqual({
      tp1_result: "be",
    });
  });

  it("writes nothing for open or unknown", () => {
    expect(outcomeFields({ kind: "still_open" })).toEqual({});
    expect(outcomeFields({ kind: "unknown" })).toEqual({});
  });
});

describe("isClosedOutcome", () => {
  it("is what decides whether the posters will ever count it", () => {
    expect(isClosedOutcome({ kind: "closed_at", exit_price: 1 })).toBe(true);
    expect(isClosedOutcome({ kind: "result", result: "sl" })).toBe(true);
    expect(isClosedOutcome({ kind: "still_open" })).toBe(false);
    expect(isClosedOutcome({ kind: "unknown" })).toBe(false);
  });
});

describe("the ways a loss gets published as a win", () => {
  // Every case here was produced by the adversarial review against the first
  // version of this parser, which saved each one. They are the reason the
  // matching is now strict about adjacency instead of loose about proximity.

  it("does not credit a TP because its price sits near 'hit'", () => {
    expect(parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350 sl hit")).toMatchObject({
      kind: "result",
      result: "sl",
    });
    expect(parseOutcome("tp2 3360 stop hit")).toMatchObject({ result: "sl" });
    expect(parseOutcome("tp1 3350 hit sl")).toMatchObject({ result: "sl" });
  });

  it("credits the TP that was named, not the nearest price", () => {
    expect(parseOutcome("tp1 3350 tp2 3360 tp1 hit")).toMatchObject({
      result: "hit",
      tpIndex: 1,
    });
    expect(parseOutcome("tp1 3350 tp2 3360 tp3 3370 tp2 hit")).toMatchObject({
      tpIndex: 2,
    });
    expect(
      parseOutcome("GBPUSD sell 1.2700 sl 1.2740 tp1 1.2650 tp2 1.2600 tp1 hit"),
    ).toMatchObject({ tpIndex: 1 });
  });

  it("reads 'closed at be' as breakeven even after a TP list", () => {
    expect(parseOutcome("tp1 3350 tp2 3360 closed at be")).toMatchObject({ result: "be" });
  });

  it("does not read the English word 'be' as breakeven", () => {
    expect(
      parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350 stopped, should be better next time"),
    ).toMatchObject({ result: "sl" });
    expect(
      parseOutcome("XAUUSD buy 3340 sl 3335, will be closing tomorrow, still open").kind,
    ).toBe("still_open");
  });

  it("does not read a moved or trailing stop as a stop-out", () => {
    expect(
      parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350, sl moved to 3345, still open").kind,
    ).toBe("still_open");
    expect(parseOutcome("trailing stop, still open").kind).toBe("still_open");
  });

  it("reads a bare 'sl' as the verdict only when it ends the message", () => {
    expect(parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350 sl")).toMatchObject({ result: "sl" });
    expect(parseOutcome("XAUUSD buy 3340 sl 3335 tp1 3350 sl.")).toMatchObject({ result: "sl" });
  });

  it("reads an explicit stop-out price as the exit", () => {
    expect(parseOutcome("XAUUSD buy 3340 sl 3330 stopped at 3332")).toMatchObject({
      kind: "closed_at",
      exit_price: 3332,
    });
  });

  it("does not take a pip count or a word count as the exit price", () => {
    expect(parseOutcome("XAUUSD buy 3340 closed +80 pips").kind).toBe("unknown");
    expect(parseOutcome("closed -50 pips").kind).toBe("unknown");
    expect(parseOutcome("tp1 3350, out of 3 trades this was the best").kind).toBe("unknown");
    expect(parseOutcome("closed at 10:30").kind).toBe("unknown");
  });

  it("reads a thousands separator as thousands, not as a decimal", () => {
    expect(parseOutcome("BTCUSD buy 65000 closed 66,500")).toMatchObject({ exit_price: 66500 });
    expect(parseOutcome("closed 1,234.5")).toMatchObject({ exit_price: 1234.5 });
    expect(parseOutcome("EURUSD closed 1,0820")).toMatchObject({ exit_price: 1.082 });
  });

  it("does not drop the sign off a negative number", () => {
    expect(parseOutcome("closed -5").kind).toBe("unknown");
  });

  it("asks rather than guesses when two outcomes are written", () => {
    expect(parseOutcome("tp1 hit, stopped out").kind).toBe("unknown");
    expect(parseOutcome("closed 3348, still open").kind).toBe("unknown");
    expect(parseOutcome("be, still open").kind).toBe("unknown");
  });

  it("refuses a partial close, which one row cannot represent", () => {
    expect(parseOutcome("closed half at 3348 rest running").kind).toBe("unknown");
    expect(parseOutcome("partial at 3348").kind).toBe("unknown");
  });
});
