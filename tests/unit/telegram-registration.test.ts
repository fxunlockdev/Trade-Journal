import { describe, expect, it } from "vitest";
import {
  webhookUrl,
  webhookFingerprint,
  WEBHOOK_UPDATES,
} from "@/lib/telegram/registration";

/**
 * A stale webhook registration fails SILENTLY: Telegram stops delivering the
 * update types it was not told about and says nothing. These pin the two things
 * that must change the fingerprint, and the one that must not.
 */

const URL_A = "https://www.fx-apps.com/api/telegram/webhook";

describe("webhookUrl", () => {
  it("builds the endpoint from the app origin", () => {
    expect(webhookUrl("https://www.fx-apps.com")).toBe(URL_A);
  });

  it("tolerates a trailing slash", () => {
    // Otherwise the URL differs by one character, the live check never matches,
    // and the scheduler re-registers on every single tick forever.
    expect(webhookUrl("https://www.fx-apps.com/")).toBe(URL_A);
  });
});

describe("webhookFingerprint", () => {
  it("changes when the secret changes", () => {
    // The reason this exists: getWebhookInfo never returns the secret, so a
    // secret change is undetectable by asking Telegram.
    expect(webhookFingerprint(URL_A, "one")).not.toBe(
      webhookFingerprint(URL_A, "two"),
    );
  });

  it("changes when the update types change", () => {
    // Missing channel_post is what made a real user's claim codes vanish.
    expect(webhookFingerprint(URL_A, "s", ["message"])).not.toBe(
      webhookFingerprint(URL_A, "s", ["message", "channel_post"]),
    );
  });

  it("changes when the URL changes", () => {
    expect(webhookFingerprint(URL_A, "s")).not.toBe(
      webhookFingerprint("https://staging.fx-apps.com/api/telegram/webhook", "s"),
    );
  });

  it("does NOT change when the update list is merely reordered", () => {
    // A reorder is not a change, and treating it as one would re-register on
    // every tick for no reason.
    expect(webhookFingerprint(URL_A, "s", ["message", "channel_post"])).toBe(
      webhookFingerprint(URL_A, "s", ["channel_post", "message"]),
    );
  });

  it("is stable for identical input", () => {
    expect(webhookFingerprint(URL_A, "s")).toBe(webhookFingerprint(URL_A, "s"));
  });

  it("does not leak the secret into the stored value", () => {
    const fp = webhookFingerprint(URL_A, "sup3rs3cr3t-value");
    expect(fp).not.toContain("sup3rs3cr3t");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("WEBHOOK_UPDATES", () => {
  it("includes channel_post", () => {
    // A channel delivers posts as channel_post and never as message. Omitting
    // it means the bot is added to a channel, records it, and then never sees
    // anything posted there.
    expect(WEBHOOK_UPDATES).toContain("channel_post");
  });

  it("includes what commands and buttons need", () => {
    expect(WEBHOOK_UPDATES).toContain("message");
    expect(WEBHOOK_UPDATES).toContain("callback_query");
    expect(WEBHOOK_UPDATES).toContain("my_chat_member");
  });
});
