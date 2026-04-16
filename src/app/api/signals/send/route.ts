import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { generateSignalMessage } from "@/lib/signals/templates";
import type { Signal } from "@/types/database";

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

    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).signal_id !== "string"
    ) {
      return NextResponse.json(
        { error: "signal_id is required" },
        { status: 400 },
      );
    }

    const signalId = (body as Record<string, unknown>).signal_id as string;

    const { data: signal, error: fetchError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signalId)
      .single();

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

    const messageId = result.message_id
      ? String(result.message_id)
      : null;

    await supabase
      .from("signals")
      .update({
        telegram_message_id: messageId,
        status: "SENT",
      })
      .eq("id", signalId);

    await supabase.from("signal_events").insert({
      signal_id: signalId,
      event_type: "SENT",
      metadata: { telegram_message_id: messageId },
    });

    return NextResponse.json({
      data: { success: true, message_id: result.message_id },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
