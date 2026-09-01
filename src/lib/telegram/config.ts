import "server-only";
import { createHash } from "node:crypto";

/**
 * The bot token, read where it is used rather than validated at boot.
 *
 * That is the house convention for optional integrations (see lib/env.ts): a
 * missing token should degrade this one feature, not stop the server starting.
 * Callers turn `null` into a 503 "not configured" rather than a 500.
 *
 * Never returned to a client, never logged, never put in an error message.
 */
export function telegramBotToken(): string | null {
  const token = process.env.TELEGRAM_REPORTS_BOT_TOKEN?.trim();
  // A bot token is "<digits>:<35-ish chars>". Length is a cheap guard against
  // an env var that was set to an empty string or a placeholder.
  return token && token.length >= 20 ? token : null;
}

/**
 * The secret Telegram will echo back on every webhook call.
 *
 * Telegram's `secret_token` accepts ONLY `A-Za-z0-9_-`, 1 to 256 characters,
 * and rejects the entire setWebhook call otherwise:
 *
 *   Bad Request: secret token contains illegal characters
 *
 * A perfectly good random secret with a `+`, `/` or `=` in it (anything
 * base64, for instance) therefore cannot be used directly. Rather than make
 * whoever configures this learn Telegram's charset, an unsafe value is hashed
 * into a safe one.
 *
 * Deterministic, so registration and verification derive the SAME token from
 * the same env var without storing anything. Both sides call this function,
 * which is what stops them disagreeing.
 *
 * A value that is already safe passes through untouched, so a deployment that
 * was working before this existed keeps working.
 */
export function telegramWebhookSecret(): string | null {
  const raw = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  // Short secrets are refused rather than hashed into something that LOOKS
  // strong: the entropy of the derived token is the entropy of the input.
  if (!raw || raw.length < 16) return null;
  if (/^[A-Za-z0-9_-]{1,256}$/.test(raw)) return raw;
  // Hex output is inside Telegram's allowed set by construction.
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
