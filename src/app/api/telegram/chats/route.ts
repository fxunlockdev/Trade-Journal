import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { explainNoChats, listTelegramChats } from "@/lib/telegram/client";
import { telegramBotToken } from "@/lib/telegram/config";
import type { TelegramChat } from "@/lib/telegram/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Groups recorded by the webhook.
 *
 * Once a webhook is registered, Telegram answers getUpdates with 409 and there
 * is no other way to ask a bot what chats it is in. The webhook records every
 * chat it sees, and this reads them back, so connecting a new group keeps
 * working across that swap instead of breaking the day /daily shipped.
 */
async function chatsFromWebhook(
  supabase: SupabaseClient,
): Promise<readonly TelegramChat[]> {
  const { data } = await supabase
    .from("telegram_seen_chats")
    .select("chat_id, title, chat_type")
    .order("last_seen_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((r) => ({
    id: r.chat_id as string,
    title: (r.title as string | null) ?? "Untitled chat",
    type: (r.chat_type as TelegramChat["type"]) ?? "group",
  }));
}

/**
 * Groups the bot can currently see, for the connect picker.
 *
 * Authenticated because it reveals which groups the bot has been added to, and
 * because it spends a Telegram API call. It does NOT reveal the token: the
 * token is read server-side and never leaves this process.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = telegramBotToken();
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Telegram isn't configured. Add TELEGRAM_REPORTS_BOT_TOKEN and redeploy.",
        },
        { status: 503 },
      );
    }

    // The webhook's record is preferred when it has anything, because once a
    // webhook exists it is the ONLY source that still works.
    const recorded = await chatsFromWebhook(supabase);
    if (recorded.length > 0) {
      return NextResponse.json({
        data: recorded,
        meta: {
          updatesSeen: recorded.length,
          updateKinds: ["webhook"],
          privateSkipped: 0,
          hint: null,
        },
      });
    }

    const discovery = await listTelegramChats(token);
    return NextResponse.json({
      data: discovery.chats,
      // Returned so the UI can say WHY nothing was found rather than guessing
      // at one cause. Counts only — no message content, no chat contents.
      meta: {
        updatesSeen: discovery.updatesSeen,
        updateKinds: discovery.updateKinds,
        privateSkipped: discovery.privateSkipped,
        hint: discovery.chats.length === 0 ? explainNoChats(discovery) : null,
      },
    });
  } catch (err: unknown) {
    // Telegram's own description is echoed by the client's thrown Error, and it
    // can be genuinely useful here ("terminated by other getUpdates request"
    // means a webhook is registered). It never contains the token.
    const message =
      err instanceof Error ? err.message : "Couldn't reach Telegram.";
    // 409 means a webhook is registered, so getUpdates will never work again.
    // Said in terms of what to DO rather than quoting Telegram at the user.
    if (/terminated by other getUpdates|409/i.test(message)) {
      return NextResponse.json({
        data: [],
        meta: {
          updatesSeen: 0,
          updateKinds: ["webhook"],
          privateSkipped: 0,
          hint:
            "The bot now receives updates through a webhook, so it only learns " +
            "about a group once something happens there. Post a message in the " +
            "group (or re-add the bot) and try again.",
        },
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
