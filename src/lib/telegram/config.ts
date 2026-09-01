import "server-only";

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
