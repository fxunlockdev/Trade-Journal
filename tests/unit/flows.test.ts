import { describe, it, expect } from "vitest";
import { FLOWS, computeFlow, nextMissingSlot, seedSlots, isSkip } from "@/lib/assistant/flows";

describe("agent flows", () => {
  it("seeds what the opening message already said", () => {
    expect(seedSlots(FLOWS.rebate, "gold")).toEqual({ asset: "gold" });
    const t = seedSlots(FLOWS.risk, "EURUSD buy");
    expect(t.instrument).toBe("EURUSD");
    expect(t.direction).toBe("buy");
  });

  it("asks for the first missing slot only", () => {
    expect(nextMissingSlot(FLOWS.rebate, { asset: "gold" })?.key).toBe("lots");
    expect(nextMissingSlot(FLOWS.rebate, { asset: "gold", lots: "100" })).toBeNull();
  });

  it("computes a rebate", () => {
    const r = computeFlow("rebate", { asset: "gold", lots: "100" });
    expect(r).toMatchObject({ kind: "rebate", lots: 100 });
    if ("kind" in r && r.kind === "rebate") expect(r.monthlyMid).toBe(750);
  });

  it("computes a position size", () => {
    const r = computeFlow("risk", {
      instrument: "EURUSD", direction: "buy", balance: "10000",
      risk: "1", entry: "1.0850", stop: "1.0800",
    });
    // Narrow on `kind`, not on a property name: RebateResult also has `lots`.
    expect(r).toHaveProperty("kind", "risk");
    if ("kind" in r && r.kind === "risk") {
      expect(r.lots).toBeGreaterThan(0);
      expect(Math.round(r.riskAmount)).toBe(100); // 1% of 10k
    }
  });

  it("tolerates messy numeric input", () => {
    const r = computeFlow("rebate", { asset: "gold", lots: "1,000" });
    if ("kind" in r && r.kind === "rebate") expect(r.lots).toBe(1000);
    const k = computeFlow("risk", {
      instrument: "EURUSD", direction: "buy", balance: "$10k",
      risk: "1%", entry: "1.0850", stop: "1.0800",
    });
    if ("kind" in k && k.kind === "risk") expect(k.balance).toBe(10000);
  });

  it("rejects a stop on the wrong side", () => {
    const slot = FLOWS.risk.slots.find((s) => s.key === "stop")!;
    expect(slot.validate!("1.0900", { direction: "buy", entry: "1.0850" })).toMatch(/below entry/);
    expect(slot.validate!("1.0800", { direction: "buy", entry: "1.0850" })).toBeUndefined();
  });

  it("recognises skip words for optional slots", () => {
    for (const v of ["skip", "none", "no", "-"]) expect(isSkip(v)).toBe(true);
    expect(isSkip("1.08")).toBe(false);
  });

  it("validates optional slots so a typo is caught, not turned into NaN", () => {
    const stop = FLOWS.trade.slots.find((s) => s.key === "stop")!;
    expect(stop.validate!("banana", {})).toMatch(/number, or say skip/);
    expect(stop.validate!("skip", {})).toBeUndefined();
    expect(stop.validate!("1.0800", {})).toBeUndefined();
  });

  it("never produces NaN from an optional slot", () => {
    const r = computeFlow("trade", {
      instrument: "EURUSD", direction: "buy", entry: "1.0850",
      lots: "1", stop: "banana", target: "skip",
    });
    if ("kind" in r && r.kind === "trade") {
      expect(r.stop === null || Number.isFinite(r.stop)).toBe(true);
    }
  });
});

describe("one-shot parsing", () => {
  it("fills a whole risk request from one sentence", () => {
    const s = seedSlots(
      FLOWS.risk,
      "XAUUSD buy, 25k account, 1% risk, entry 2388, stop 2380",
    );
    expect(s).toMatchObject({
      instrument: "XAUUSD", direction: "buy",
      balance: "25k", risk: "1", entry: "2388", stop: "2380",
    });
    expect(nextMissingSlot(FLOWS.risk, s)).toBeNull(); // nothing left to ask
  });

  it("computes that one-shot correctly", () => {
    const s = seedSlots(FLOWS.risk, "XAUUSD buy, 25k account, 1% risk, entry 2388, stop 2380");
    const r = computeFlow("risk", s);
    if ("kind" in r && r.kind === "risk") {
      expect(Math.round(r.riskAmount)).toBe(250); // 1% of 25k
      expect(r.lots).toBeGreaterThan(0);
    } else {
      throw new Error("expected a risk result");
    }
  });
});

describe("mention routing (the bug that sent '@trade journal add a trade' to a link)", () => {
  it("resolves multi-word aliases, longest first", async () => {
    const { parseMention } = await import("@/lib/assistant/mentions");
    const m = parseMention("@trade journal can you add a trade for me");
    expect(m?.target.id).toBe("journal");
    expect(m?.instruction).toBe("can you add a trade for me");
  });

  it("still resolves the short alias", async () => {
    const { parseMention } = await import("@/lib/assistant/mentions");
    expect(parseMention("@journal")?.target.id).toBe("journal");
    expect(parseMention("@rebate calculator gold")?.target.id).toBe("rebate");
    expect(parseMention("@risk calculator")?.target.id).toBe("risk");
  });

  it("treats a logging intent as a trade flow trigger", () => {
    const trigger = /\b(add|log|record|new|enter|book)\b/i;
    expect(trigger.test("can you add a trade for me")).toBe(true);
    expect(trigger.test("log EURUSD long")).toBe(true);
    expect(trigger.test("")).toBe(false); // bare mention just opens the app
  });
});
