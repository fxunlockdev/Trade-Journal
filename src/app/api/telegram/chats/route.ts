import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { explainNoChats, listTelegramChats } from "@/lib/telegram/client";
import { telegramBotToken } from "@/lib/telegram/config";

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
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
