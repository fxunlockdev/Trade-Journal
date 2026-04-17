import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { generateSignalMessage } from "@/lib/signals/templates";
import { isTrader } from "@/lib/constants/roles";
import type { Signal } from "@/types/database";

const bodySchema = z
  .object({
    signal_id: z.string().uuid(),
  })
  .strict();

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

    // Role gate — only traders/admins can dispatch signals.
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = (profile?.role as string | undefined) ?? "user";
    const isAdmin = role === "admin";
    if (!isAdmin && !isTrader(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const raw: unknown = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "signal_id is required (uuid)" },
        { status: 400 },
      );
    }
    const { signal_id: signalId } = parsed.data;

    // Ownership-scoped fetch: non-admin traders can only send their own signals.
    const fetchQuery = supabase.from("signals").select("*").eq("id", signalId);
    if (!isAdmin) fetchQuery.eq("trader_id", user.id);
    const { data: signal, error: fetchError } = await fetchQuery.single();

    if (fetchError || !signal) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 },
      );
    }

    const typedSignal = signal as Signal;

    const messageText =
      typedSignal.formatted_message ?? generateSignalMessage(typedSignal);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return NextResponse.json(
        {
          error:
            "Telegram not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to your environment variables.",
        },
        { status: 400 },
      );
    }

    const result = await sendTelegramMessage(botToken, chatId, messageText);

    const messageId = result.message_id ? String(result.message_id) : null;

    const updateQuery = supabase
      .from("signals")
      .update({
        telegram_message_id: messageId,
        status: "SENT",
      })
      .eq("id", signalId);
    if (!isAdmin) updateQuery.eq("trader_id", user.id);
    const { error: updateError } = await updateQuery;

    if (updateError) {
      console.error(
        "[TRDR] signal SENT update failed after Telegram dispatch:",
        updateError.message,
      );
      return NextResponse.json(
        {
          error:
            "Telegram message sent but database update failed. Signal is in an inconsistent state.",
          telegram_message_id: messageId,
        },
        { status: 500 },
      );
    }

    const { error: eventError } = await supabase.from("signal_events").insert({
      signal_id: signalId,
      event_type: "SENT",
      metadata: { telegram_message_id: messageId },
    });

    if (eventError) {
      console.error(
        "[TRDR] signal_events insert failed:",
        eventError.message,
      );
    }

    return NextResponse.json({
      data: { success: true, message_id: result.message_id },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
