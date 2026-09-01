import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { telegramBotToken } from "@/lib/telegram/config";

/**
 * Connect (or re-point) the chat marketing images publish to.
 *
 * Writes go through the admin client because the table's writes are revoked
 * from `authenticated` on purpose: connecting means PROVING the chat is
 * reachable, which needs the bot token, which only the server has. A
 * client-side insert could record a "connected" destination that was never
 * verified, and the first anyone would learn of it is a silent 06:00 failure.
 *
 * So the order is: send first, store second. A destination row only ever
 * exists for a chat we have actually delivered to.
 */
const connectSchema = z.object({
  // TEXT, not a number: supergroup ids exceed JavaScript's safe integer range,
  // so parsing one as a Number silently addresses a different chat.
  chat_id: z.string().trim().min(1).max(64),
  chat_title: z.string().trim().max(200).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = connectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
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

    // PROVE THE CALLER IS IN THIS CHAT.
    //
    // Reachability (below) proves only that the BOT can post there, which says
    // nothing about who is asking. Without this check any signed-in user could
    // name any chat id the bot is in and publish their results into someone
    // else's group. The claim is the evidence: a code this user generated,
    // posted inside that chat, where only a member could put it.
    const { data: claim } = await supabase
      .from("telegram_chat_claims")
      .select("code")
      .eq("chat_id", parsed.data.chat_id)
      .not("claimed_at", "is", null)
      .maybeSingle();

    if (!claim) {
      return NextResponse.json(
        {
          error:
            "You haven't verified that group yet. Post the code from the Posters page in it, then connect.",
        },
        { status: 403 },
      );
    }

    // Prove reachability BEFORE recording anything.
    try {
      await sendTelegramMessage(
        token,
        parsed.data.chat_id,
        "*Trade Journal connected.*\nMarketing images will be published here.",
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "unknown error";
      return NextResponse.json(
        {
          error:
            "Couldn't post to that chat. Check the bot is still a member and can send messages.",
          detail,
        },
        { status: 502 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("telegram_destinations")
      .upsert(
        {
          owner_user_id: user.id,
          chat_id: parsed.data.chat_id,
          chat_title: parsed.data.chat_title ?? null,
          status: "connected",
          last_error: null,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "owner_user_id" },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("telegram_destinations")
      .delete()
      .eq("owner_user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
