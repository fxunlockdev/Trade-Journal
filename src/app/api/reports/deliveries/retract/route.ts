import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { deleteChatMessage } from "@/lib/telegram/chat";

/**
 * Remove albums from a chat after the fact.
 *
 * Exists because a bug published eleven albums into a partner channel, and the
 * only thing that can undo that is the bot itself: Telegram lets it delete its
 * own messages for roughly 48 hours.
 *
 * Bounded by an explicit time window rather than "delete everything", because
 * this is irreversible and outward-facing. The caller has to say WHICH sends
 * they mean, and can only ever reach their own: the deliveries are read through
 * the RLS-scoped client, so another tenant's messages are not merely refused,
 * they are absent from the query.
 *
 * The rows are kept and stamped, never deleted. A delivery record is the reason
 * the claim function refuses to publish that period again, and removing it
 * would invite the scheduler to send the whole lot a second time. Deleting the
 * messages is not the same as never having sent them.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

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

    const body: unknown = await request.json().catch(() => null);
    const read = (k: string): string | undefined => {
      const v =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)[k]
          : undefined;
      return typeof v === "string" ? v : undefined;
    };

    const sentAfter = read("sentAfter");
    const sentBefore = read("sentBefore");
    const chatId = read("chatId");

    if (!sentAfter || !sentBefore) {
      return NextResponse.json(
        {
          error:
            "sentAfter and sentBefore are required, so this can never mean 'delete everything'.",
        },
        { status: 400 },
      );
    }
    if (Number.isNaN(Date.parse(sentAfter)) || Number.isNaN(Date.parse(sentBefore))) {
      return NextResponse.json(
        { error: "sentAfter and sentBefore must be ISO timestamps." },
        { status: 400 },
      );
    }

    const botToken = telegramBotToken();
    if (!botToken) {
      return NextResponse.json(
        { error: "The Telegram bot is not configured." },
        { status: 503 },
      );
    }

    // RLS-scoped: only this owner's deliveries exist to this query.
    let query = supabase
      .from("report_deliveries")
      .select("id, chat_id, message_ids, sent_at")
      .eq("status", "sent")
      .is("retracted_at", null)
      .gte("sent_at", sentAfter)
      .lte("sent_at", sentBefore)
      .order("sent_at", { ascending: true });

    if (chatId) query = query.eq("chat_id", chatId);

    const { data: deliveries, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "Couldn't read those deliveries." },
        { status: 503 },
      );
    }
    if (!deliveries || deliveries.length === 0) {
      return NextResponse.json({
        data: { albums: 0, deleted: 0, failed: 0, note: "Nothing matched." },
      });
    }

    const admin = createAdminClient();
    let deleted = 0;
    let failed = 0;
    const retracted: string[] = [];

    for (const delivery of deliveries) {
      const ids = Array.isArray(delivery.message_ids)
        ? (delivery.message_ids as number[])
        : [];

      let allGone = true;
      for (const messageId of ids) {
        const ok = await deleteChatMessage(
          botToken,
          delivery.chat_id as string,
          messageId,
        );
        if (ok) deleted += 1;
        else {
          failed += 1;
          allGone = false;
        }
      }

      // Stamped only when the whole album went, so a partly-removed one stays
      // visible as unfinished rather than being recorded as cleaned up.
      if (allGone && ids.length > 0) {
        await admin
          .from("report_deliveries")
          .update({ retracted_at: new Date().toISOString() })
          .eq("id", delivery.id as string);
        retracted.push(delivery.id as string);
      }
    }

    return NextResponse.json({
      data: {
        albums: deliveries.length,
        retracted: retracted.length,
        deleted,
        failed,
      },
    });
  } catch (err: unknown) {
    console.error("[deliveries/retract] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
