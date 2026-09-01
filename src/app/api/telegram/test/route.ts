import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowRequest, LIMITS } from "@/lib/rate-limit";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { telegramBotToken } from "@/lib/telegram/config";

/**
 * Post a test message to the connected chat.
 *
 * Rate limited: this is a button that makes a third party deliver a message to
 * a group of partners, so a stuck finger should not turn into twenty
 * notifications for everyone in it.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await allowRequest(supabase, LIMITS.telegramTest, user.id))) {
      return NextResponse.json(
        { error: "Too many test messages. Wait a minute and try again." },
        { status: 429 },
      );
    }

    const { data: destination } = await supabase
      .from("telegram_destinations")
      .select("chat_id, chat_title")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (!destination) {
      return NextResponse.json(
        { error: "No Telegram group connected yet." },
        { status: 404 },
      );
    }

    const token = telegramBotToken();
    if (!token) {
      return NextResponse.json(
        { error: "Telegram isn't configured on the server." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();
    try {
      await sendTelegramMessage(
        token,
        destination.chat_id,
        "*Test message*\nTrade Journal can post here. Marketing images will arrive at 06:00.",
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "unknown error";
      // Recorded, so the connection card can show that a previously working
      // destination has since broken — the bot removed from the group, say —
      // rather than looking connected until the next scheduled run fails.
      await admin
        .from("telegram_destinations")
        .update({ status: "error", last_error: detail })
        .eq("owner_user_id", user.id);
      return NextResponse.json(
        {
          error:
            "Couldn't post. Check the bot is still in the group and allowed to send messages.",
          detail,
        },
        { status: 502 },
      );
    }

    await admin
      .from("telegram_destinations")
      .update({ status: "connected", last_error: null })
      .eq("owner_user_id", user.id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
