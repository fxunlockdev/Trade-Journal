import { describe, expect, it } from "vitest";
import { secretMatches } from "@/lib/telegram/webhook-secret";

describe("secretMatches", () => {
  it("accepts the configured secret and nothing else", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
    expect(secretMatches("abc124", "abc123")).toBe(false);
    expect(secretMatches("abc12", "abc123")).toBe(false);
    expect(secretMatches("", "abc123")).toBe(false);
    expect(secretMatches(null, "abc123")).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    // An unset secret must not become "any header passes".
    expect(secretMatches("", null)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});
