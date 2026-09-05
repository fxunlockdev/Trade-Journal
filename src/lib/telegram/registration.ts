import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Keeping Telegram's webhook registration correct, without anyone remembering.
 *
 * A registration is not fire-and-forget. The URL, the secret, and the list of
 * update types are all part of it, and Telegram never says one is stale: it
 * just stops delivering what you did not subscribe to. That failure is silent
 * and looks like a bug in the app. It already cost a real user three claim
 * codes posted into a channel that were never delivered, because channel_post
 * was missing from the list.
 *
 * Twice that meant asking a person to re-run a setup step after a deploy. So
 * the scheduler now checks on every tick and fixes it itself.
 */

/**
 * THE list of update types, in one place.
 *
 * channel_post is not optional: a Telegram CHANNEL delivers posts as
 * channel_post and never as message, so omitting it means the bot is added to a
 * channel, records it, and then never sees a thing posted there.
 *
 * Sorted, because this feeds a fingerprint and a reordering must not read as a
 * change that triggers a pointless re-registration.
 */
export const WEBHOOK_UPDATES: readonly string[] = [
  "callback_query",
  "channel_post",
  // Traders edit a signal to add "TP1 hit ✅" to it. Without these the edit
  // never arrives and the result is silently missed.
  "edited_channel_post",
  "edited_message",
  "message",
  "my_chat_member",
];

export function webhookUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
}

/**
 * A hash of everything that makes a registration what it is.
 *
 * The secret is included so a change to it forces a re-registration, and hashed
 * so the stored row never holds the secret itself. getWebhookInfo does not
 * return the secret token, so comparing fingerprints is the ONLY way to notice
 * it changed.
 */
export function webhookFingerprint(
  url: string,
  secret: string,
  updates: readonly string[] = WEBHOOK_UPDATES,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ url, secret, updates: [...updates].sort() }))
    .digest("hex");
}

export interface RegistrationOutcome {
  readonly registered: boolean;
  /** Why it did or did not act, for the cron's own log line. */
  readonly reason: string;
  readonly url?: string;
}

interface TelegramEnvelope<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
}

async function call<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<TelegramEnvelope<T> | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return (await response.json()) as TelegramEnvelope<T>;
  } catch {
    return null;
  }
}

/**
 * Register the webhook if what Telegram has does not match what we want.
 *
 * Two independent checks, because they catch different things:
 *
 *   fingerprint  our own config changed (a new secret, a new update type).
 *                Telegram cannot answer this, since it never returns the
 *                secret, so it is compared against what we last sent.
 *   live URL     something changed it out from under us, or it was never
 *                registered on this deployment at all.
 *
 * Safe to call on a schedule: when everything matches it costs one
 * getWebhookInfo and writes nothing.
 */
export async function ensureWebhookRegistered(
  admin: SupabaseClient,
  botToken: string,
  appUrl: string,
  secret: string,
): Promise<RegistrationOutcome> {
  const url = webhookUrl(appUrl);
  const desired = webhookFingerprint(url, secret);

  const { data: state } = await admin
    .from("telegram_webhook_state")
    .select("fingerprint, url")
    .eq("id", true)
    .maybeSingle();

  const info = await call<{ url?: string }>(botToken, "getWebhookInfo");
  const liveUrl = info?.ok ? (info.result?.url ?? "") : null;

  const configMatches = state?.fingerprint === desired;
  // A null liveUrl means the check itself failed. Treating that as "matches"
  // avoids re-registering on every tick during a Telegram outage, when the
  // registration is probably fine and hammering setWebhook would not help.
  const liveMatches = liveUrl === null || liveUrl === url;

  if (configMatches && liveMatches) {
    return { registered: false, reason: "already current", url };
  }

  const set = await call(botToken, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: [...WEBHOOK_UPDATES],
    // NOT dropping pending updates here. This runs unattended, and a queued
    // claim code someone posted a minute ago is exactly the thing that must
    // survive a re-registration rather than being thrown away.
    drop_pending_updates: false,
  });

  if (!set?.ok) {
    return {
      registered: false,
      reason: `Telegram refused: ${set?.description ?? "no response"}`,
      url,
    };
  }

  await admin
    .from("telegram_webhook_state")
    .upsert(
      { id: true, fingerprint: desired, url, registered_at: new Date().toISOString() },
      { onConflict: "id" },
    );

  return {
    registered: true,
    reason: !configMatches ? "configuration changed" : "registration had drifted",
    url,
  };
}
