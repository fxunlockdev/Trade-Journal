import { beforeEach, describe, expect, it } from "vitest";
import {
  createRenderToken,
  verifyRenderToken,
} from "@/lib/reports/render-token";

/**
 * This token is the ONLY thing standing between the open internet and a page
 * that renders a customer's trading performance. The headless browser that
 * loads it carries no cookies, so there is no session behind it.
 */

const NOW = 1_800_000_000;
const SECRET = "a".repeat(64);

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("round trip", () => {
  it("verifies a token it just minted", () => {
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    expect(verifyRenderToken(t, NOW)).toEqual({
      snapshotId: "snap-1",
      style: "design-a",
      exp: NOW + 300,
    });
  });
});

describe("rejections", () => {
  it("refuses a tampered payload", () => {
    // The whole point: swapping the snapshot id must not survive.
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    const [, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ snapshotId: "someone-elses", style: "design-a", exp: NOW + 300 }),
    ).toString("base64url");
    expect(verifyRenderToken(`${forged}.${sig}`, NOW)).toBeNull();
  });

  it("refuses a tampered signature", () => {
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    const [payload] = t.split(".");
    expect(verifyRenderToken(`${payload}.notasignature`, NOW)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    process.env.CRON_SECRET = "b".repeat(64);
    expect(verifyRenderToken(t, NOW)).toBeNull();
  });

  it("refuses an expired token", () => {
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    expect(verifyRenderToken(t, NOW + 301)).toBeNull();
    // And is still good a second before.
    expect(verifyRenderToken(t, NOW + 299)).not.toBeNull();
  });

  it("refuses malformed shapes without throwing", () => {
    for (const bad of ["", ".", "a.", ".b", "no-dot", "a.b.c"]) {
      expect(() => verifyRenderToken(bad, NOW)).not.toThrow();
      expect(verifyRenderToken(bad, NOW)).toBeNull();
    }
  });

  it("refuses a payload that is valid base64 but not the right shape", () => {
    const key = SECRET;
    const payload = Buffer.from(JSON.stringify({ nope: true })).toString("base64url");
    // Sign it properly, so only the shape check can reject it.
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const sig = createHmac("sha256", key).update(payload).digest("base64url");
    expect(verifyRenderToken(`${payload}.${sig}`, NOW)).toBeNull();
  });

  it("mints and verifies NOTHING when no secret is configured", () => {
    // Falling back to an unsigned URL would publish the page to anyone.
    delete process.env.CRON_SECRET;
    expect(createRenderToken("snap-1", "design-a", NOW)).toBeNull();
    expect(verifyRenderToken("anything.atall", NOW)).toBeNull();
  });

  it("refuses a secret too short to be meant seriously", () => {
    process.env.CRON_SECRET = "short";
    expect(createRenderToken("snap-1", "design-a", NOW)).toBeNull();
  });
});

describe("scope", () => {
  it("a token for one style does not authorise another", () => {
    // Each render gets its own token, so a leaked one is worth one image.
    const t = createRenderToken("snap-1", "design-a", NOW)!;
    expect(verifyRenderToken(t, NOW)?.style).toBe("design-a");
  });

  it("a token for one snapshot does not authorise another", () => {
    const a = createRenderToken("snap-1", "design-a", NOW)!;
    const b = createRenderToken("snap-2", "design-a", NOW)!;
    expect(a).not.toBe(b);
    expect(verifyRenderToken(a, NOW)?.snapshotId).toBe("snap-1");
  });
});
