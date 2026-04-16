import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { generateSignalMessage } from "@/lib/signals/templates";
import { isTrader } from "@/lib/constants/roles";
import type { Signal } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !isTrader(profile.role)) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const { signal_id } = body as { signal_id: string };

    if (!signal_id) {
      return NextResponse.json(
        { success: false, error: "signal_id is required" },
        { status: 400 },
      );
    }

    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signal_id)
      .single();

    if (signalError || !signal) {
      return NextResponse.json(
        { success: false, error: "Signal not found" },
        { status: 404 },
      );
    }

    const typedSignal = signal as Signal;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram not configured yet. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your environment variables.",
        },
        { status: 422 },
      );
    }

    const messageText =
      typedSignal.formatted_message ?? generateSignalMessage(typedSignal);

    const telegramResponse = await sendTelegramMessage(
      botToken,
      chatId,
      messageText,
    );

    if (!telegramResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: telegramResponse.description ?? "Failed to send Telegram message",
        },
        { status: 502 },
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("signals")
      .update({
        telegram_message_id: String(telegramResponse.message_id),
        formatted_message: messageText,
        status: "SENT",
      })
      .eq("id", signal_id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 },
      );
    }

    await supabase.from("signal_events").insert({
      signal_id,
      event_type: "SENT",
      metadata: {
        sent_by: user.id,
        telegram_message_id: telegramResponse.message_id,
      },
    });

    return NextResponse.json({
      success: true,
      data: updated as Signal,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
