import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { telegramBotToken, telegramWebhookSecret } from "@/lib/telegram/config";

/**
 * Point the bot at this deployment's webhook.
 *
 * Run once, by a signed-in user, so the bot token never has to be handled by
 * hand in a terminal. Idempotent: calling it again re-registers the same URL.
 *
 * Registering a webhook permanently disables getUpdates for this bot (Telegram
 * answers 409 while one is set), which is why the connect picker now reads the
 * chats the webhook records instead.
 */
export const runtime = "nodejs";

async function callTelegram(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    },
  );
  return (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: unknown;
  };
}

/** What Telegram currently thinks, so a misconfiguration is visible. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = telegramBotToken();
  if (!botToken) {
    return NextResponse.json(
      { error: "The Telegram bot is not configured." },
      { status: 503 },
    );
  }

  const info = await callTelegram(botToken, "getWebhookInfo");
  const result = (info.result ?? {}) as {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
    last_error_date?: number;
  };

  // The URL is echoed but never the secret token, which Telegram does not
  // return anyway and which must not appear in a client response.
  return NextResponse.json({
    data: {
      url: result.url || null,
      pending: result.pending_update_count ?? 0,
      lastError: result.last_error_message ?? null,
    },
  });
}

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = telegramBotToken();
  // Derived, so a secret containing characters Telegram refuses still works.
  const secret = telegramWebhookSecret();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!botToken || !secret || !appUrl) {
    return NextResponse.json(
      {
        error:
          "Telegram is not fully configured. TELEGRAM_REPORTS_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (16+ characters) and NEXT_PUBLIC_APP_URL are all required.",
      },
      { status: 503 },
    );
  }

  const url = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;

  const set = await callTelegram(botToken, "setWebhook", {
    url,
    // The shared secret Telegram will send back in a header on every update.
    // Without it this endpoint is an open door to publishing.
    secret_token: secret,
    // Only what the commands need. Narrower means fewer updates to reason
    // about, and my_chat_member is what records a newly added group.
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    // Updates queued before this point refer to a world that no longer exists.
    drop_pending_updates: true,
  });

  if (!set.ok) {
    return NextResponse.json(
      { error: set.description ?? "Telegram refused the webhook." },
      { status: 502 },
    );
  }

  return NextResponse.json({ data: { url, registered: true } });
}
