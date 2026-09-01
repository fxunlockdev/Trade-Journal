import { describe, expect, it, vi } from "vitest";
import {
  parseCommand,
  encodePublish,
  decodePublish,
  isAdminStatus,
  isCadence,
  CALLBACK_DATA_MAX,
} from "@/lib/telegram/commands";

/**
 * These parse a webhook body, which is an unauthenticated POST until the secret
 * header proves otherwise, and callback data, which the client chooses. The
 * tests are mostly about what must NOT be accepted.
 */

const DESK = "11111111-2222-3333-4444-555555555555";

describe("parseCommand", () => {
  it("reads the three cadences", () => {
    expect(parseCommand("/daily")).toBe("daily");
    expect(parseCommand("/weekly")).toBe("weekly");
    expect(parseCommand("/monthly")).toBe("monthly");
  });

  it("accepts the @botname suffix Telegram adds in groups", () => {
    // With several bots in a group Telegram sends "/daily@TheBot", and a parser
    // that misses this makes the command silently do nothing in exactly the
    // multi-bot groups it is meant for.
    expect(parseCommand("/daily@TradingJournalImagesBot")).toBe("daily");
  });

  it("is case insensitive and tolerates surrounding whitespace", () => {
    expect(parseCommand("  /DAILY  ")).toBe("daily");
  });

  it("ignores trailing words rather than refusing the command", () => {
    expect(parseCommand("/weekly please")).toBe("weekly");
  });

  it("is null for ordinary chat, so partners talking never triggers anything", () => {
    expect(parseCommand("daily")).toBeNull();
    expect(parseCommand("what about /daily")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it("is null for unknown commands", () => {
    expect(parseCommand("/publish")).toBeNull();
    expect(parseCommand("/start")).toBeNull();
  });
});

describe("callback data", () => {
  it("round-trips", () => {
    const decoded = decodePublish(encodePublish("weekly", DESK));
    expect(decoded).toEqual({ cadence: "weekly", deskId: DESK });
  });

  it("stays inside Telegram's 64-byte cap", () => {
    // Over the cap Telegram rejects the button outright, so the whole desk
    // picker would silently fail to render.
    expect(encodePublish("monthly", DESK).length).toBeLessThanOrEqual(
      CALLBACK_DATA_MAX,
    );
  });

  it("rejects anything malformed", () => {
    expect(decodePublish(undefined)).toBeNull();
    expect(decodePublish("")).toBeNull();
    expect(decodePublish("pub:daily")).toBeNull();
    expect(decodePublish("pub:daily:x:y")).toBeNull();
    expect(decodePublish(`del:daily:${DESK}`)).toBeNull();
    expect(decodePublish(`pub:hourly:${DESK}`)).toBeNull();
    expect(decodePublish("pub:daily:not-a-uuid")).toBeNull();
  });

  it("rejects a desk id carrying SQL or path characters", () => {
    expect(decodePublish("pub:daily:' or 1=1--")).toBeNull();
    expect(decodePublish("pub:daily:../../etc/passwd")).toBeNull();
  });

  it("accepts a well-formed id belonging to anyone", () => {
    // Deliberate: shape is all this layer checks. Whether the desk belongs to
    // the chat's owner is decided against the database, because a valid uuid
    // from another tenant looks identical here.
    expect(decodePublish(encodePublish("daily", DESK))).not.toBeNull();
  });
});

describe("isAdminStatus", () => {
  it("admits creators and administrators", () => {
    expect(isAdminStatus("creator")).toBe(true);
    expect(isAdminStatus("administrator")).toBe(true);
  });

  it("refuses everyone else, including former admins", () => {
    // 'left' and 'kicked' matter: someone removed from the group must lose the
    // ability to publish to it.
    for (const s of ["member", "restricted", "left", "kicked", "", undefined]) {
      expect(isAdminStatus(s)).toBe(false);
    }
  });
});

describe("isCadence", () => {
  it("guards the three known values", () => {
    expect(isCadence("daily")).toBe(true);
    expect(isCadence("yearly")).toBe(false);
    expect(isCadence("__proto__")).toBe(false);
  });
});

describe("webhook secret derivation", () => {
  // Imported lazily: config.ts is server-only and reads the environment.
  const load = async () => {
    vi.resetModules();
    return await import("@/lib/telegram/config");
  };

  it("passes a Telegram-safe secret through unchanged", async () => {
    // So a deployment that worked before this existed keeps working.
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "abcDEF123_-abcDEF123");
    const { telegramWebhookSecret } = await load();
    expect(telegramWebhookSecret()).toBe("abcDEF123_-abcDEF123");
  });

  it("hashes a secret containing characters Telegram refuses", async () => {
    // Telegram rejects the whole setWebhook call on `+`, `/`, `=` and friends
    // with "secret token contains illegal characters".
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "a+b/c=d!e#f$g%h^i&j*k(l)m");
    const { telegramWebhookSecret } = await load();
    const derived = telegramWebhookSecret();
    expect(derived).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(derived).not.toContain("+");
  });

  it("is deterministic, so registration and verification agree", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "a+b/c=d!e#f$g%h^i&j*k(l)m");
    const first = (await load()).telegramWebhookSecret();
    const second = (await load()).telegramWebhookSecret();
    expect(first).toBe(second);
  });

  it("refuses a short secret rather than hashing it into false strength", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "short");
    const { telegramWebhookSecret } = await load();
    expect(telegramWebhookSecret()).toBeNull();
  });

  it("is null when unset", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const { telegramWebhookSecret } = await load();
    expect(telegramWebhookSecret()).toBeNull();
  });
});
