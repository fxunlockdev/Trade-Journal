import { describe, expect, it } from "vitest";
import { createTradeFormSchema } from "@/lib/validators/trade";

/**
 * A blank OPTIONAL number field must not block submit. The form delivers empty
 * inputs as "" (react-hook-form), and z.coerce.number("") === 0 used to trip
 * .positive() with "Too small: expected number to be >0".
 */

// Minimal valid form input (strings, exactly as the <input>s produce).
const validBase = {
  instrument: "EURUSD",
  asset_type: "forex",
  direction: "buy",
  entry_price: "1.10000",
  quantity: "1",
  entry_time: "2026-07-20T12:00",
} as const;

const firstErrorFor = (result: ReturnType<typeof createTradeFormSchema.safeParse>, path: string) => {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join(".") === path)?.message;
};

describe("createTradeFormSchema — optional fields accept blank input", () => {
  it("a blank Entry High does NOT error (the reported bug)", () => {
    const r = createTradeFormSchema.safeParse({ ...validBase, entry_price_high: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entry_price_high ?? null).toBeNull();
  });

  it("every optional price/pip field can be left blank at once", () => {
    const r = createTradeFormSchema.safeParse({
      ...validBase,
      entry_price_high: "",
      exit_price: "",
      lot_size: "",
      stop_loss: "",
      sl_pips: "",
      take_profit: "",
      tp1: "",
      tp2: "",
      tp7: "",
      tp1_pips: "",
    });
    expect(r.success).toBe(true);
  });

  it("whitespace is treated as blank too", () => {
    expect(createTradeFormSchema.safeParse({ ...validBase, stop_loss: "   " }).success).toBe(true);
  });

  it("a real Entry High value still validates and coerces to a number", () => {
    const r = createTradeFormSchema.safeParse({ ...validBase, entry_price_high: "1.10100" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entry_price_high).toBeCloseTo(1.101, 5);
  });
});

describe("createTradeFormSchema — real validation still fires", () => {
  it("a required entry_price left blank still errors", () => {
    const r = createTradeFormSchema.safeParse({ ...validBase, entry_price: "" });
    expect(r.success).toBe(false);
    expect(firstErrorFor(r, "entry_price")).toBeTruthy();
  });

  it("Entry High below entry price is still rejected (geometry)", () => {
    const r = createTradeFormSchema.safeParse({ ...validBase, entry_price_high: "1.09000" });
    expect(r.success).toBe(false);
    expect(firstErrorFor(r, "entry_price_high")).toMatch(/≥ entry price/i);
  });

  it("a stop loss on the wrong side of entry is still rejected", () => {
    // buy → SL must be below entry; 1.20000 is above → error.
    const r = createTradeFormSchema.safeParse({ ...validBase, stop_loss: "1.20000" });
    expect(r.success).toBe(false);
    expect(firstErrorFor(r, "stop_loss")).toMatch(/below entry/i);
  });
});
