import { describe, expect, it } from "vitest";
import {
  generateClaimCode,
  findClaimCode,
  CLAIM_PREFIX,
  CLAIM_BODY_LENGTH,
} from "@/lib/telegram/claim";

/**
 * A claim code is the only thing proving an app user is actually in the group
 * they are connecting. Before it existed, one customer could attach another
 * customer's group to their own account and publish into it.
 */

const bytes = (...n: number[]) => new Uint8Array(n);

describe("generateClaimCode", () => {
  it("is prefixed and the right length", () => {
    const code = generateClaimCode(bytes(0, 1, 2, 3, 4, 5));
    expect(code.startsWith(CLAIM_PREFIX)).toBe(true);
    expect(code).toHaveLength(CLAIM_PREFIX.length + CLAIM_BODY_LENGTH);
  });

  it("never emits characters that get misread when typed off a screen", () => {
    // 0/O, 1/I/L and 8/B are the pairs people mistype, and a mistyped code is
    // indistinguishable from an expired one.
    const all = Array.from({ length: 256 }, (_, i) => i);
    for (let start = 0; start < 250; start += 6) {
      const code = generateClaimCode(bytes(...all.slice(start, start + 6)));
      expect(code.slice(CLAIM_PREFIX.length)).not.toMatch(/[01OIL8B]/);
    }
  });

  it("differs for different random input", () => {
    expect(generateClaimCode(bytes(0, 0, 0, 0, 0, 0))).not.toBe(
      generateClaimCode(bytes(9, 9, 9, 9, 9, 9)),
    );
  });
});

describe("findClaimCode", () => {
  it("finds a bare code", () => {
    expect(findClaimCode("TJ-ACDEFG")).toBe("TJ-ACDEFG");
  });

  it("finds one surrounded by other words", () => {
    // People type "here you go TJ-ACDEFG thanks" and refusing that would look
    // broken for no gain.
    expect(findClaimCode("here you go TJ-ACDEFG thanks")).toBe("TJ-ACDEFG");
  });

  it("is case insensitive and normalises upward", () => {
    expect(findClaimCode("tj-acdefg")).toBe("TJ-ACDEFG");
  });

  it("is null for ordinary chat", () => {
    expect(findClaimCode("morning all")).toBeNull();
    expect(findClaimCode("")).toBeNull();
    expect(findClaimCode(undefined)).toBeNull();
  });

  it("rejects a code containing excluded characters", () => {
    // TJ-AAAA0O is not a code this system can ever have issued.
    expect(findClaimCode("TJ-AAAA0O")).toBeNull();
  });

  it("rejects a short or long body", () => {
    expect(findClaimCode("TJ-ACDE")).toBeNull();
  });
});
