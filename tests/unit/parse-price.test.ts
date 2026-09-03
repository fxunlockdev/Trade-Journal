import { describe, expect, it } from "vitest";
import { parsePrice, PRICE } from "@/lib/trades/parse-price";

/**
 * One number parser for every trade parser. It exists because two copies
 * disagreed about the sign and both read "66,500" as sixty-six and a half.
 */

describe("parsePrice", () => {
  it.each([
    ["3340", 3340],
    ["1.0850", 1.085],
    ["1,0850", 1.085], // European decimal comma
    ["3,3", 3.3],
    ["66,500", 66500], // thousands
    ["1,234.5", 1234.5],
    ["1,234,567", 1234567],
    ["+80", 80],
    ["0.0001", 0.0001],
  ])("reads %j as %s", (raw, n) => {
    expect(parsePrice(raw)).toBe(n);
  });

  it.each(["0", "-5", "-3340", "abc", "", "1.2.3", "1,23,4"])(
    "refuses %j",
    (raw) => {
      expect(parsePrice(raw)).toBeNull();
    },
  );
});

describe("PRICE, the token regex", () => {
  const re = new RegExp(`^${PRICE}$`);
  it.each(["3340", "1.0850", "1,0850", "66,500", "1,234.5", "1,234,567"])(
    "matches %j whole",
    (s) => expect(re.test(s)).toBe(true),
  );
  it.each(["-5", "+80", "10:30", "abc"])("does not match %j whole", (s) =>
    expect(re.test(s)).toBe(false),
  );
});
