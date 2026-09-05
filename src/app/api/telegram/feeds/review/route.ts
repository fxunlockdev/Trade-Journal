import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestFeedMessage } from "@/lib/telegram/feed";
import { feedStore } from "@/lib/telegram/feed-store";

/**
 * What the listener kept for a person: signals it could not read, results
 * it could not attach, targets that matched nothing. Read through RLS (the
 * policy walks message -> feed -> owner); "ignore" is the one write.
 */
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error: readError } = await supabase
      .from("telegram_feed_messages")
      .select("chat_id, message_id, thread_id, feed_id, kind, status, reason, trade_id, sender, text, posted_at, telegram_feeds!inner(title, chat_id, thread_id, user_id)")
      .eq("status", "review")
      .eq("telegram_feeds.user_id", user.id)
      .order("posted_at", { ascending: false })
      .limit(100);
    if (readError) return NextResponse.json({ error: "Couldn't read the review list." }, { status: 503 });
    type Row = { chat_id: string; message_id: number; feed_id: string; kind: string; reason: string | null; trade_id: string | null; sender: string | null; text: string | null; posted_at: string; telegram_feeds: { title: string | null } };
    const items = ((data ?? []) as unknown as Row[]).map((r) => ({
      chatId: r.chat_id, messageId: Number(r.message_id), feedId: r.feed_id, kind: r.kind, reason: r.reason,
      tradeId: r.trade_id, sender: r.sender, text: (r.text ?? "").slice(0, 400), postedAt: r.posted_at, room: r.telegram_feeds?.title ?? null,
    }));
    return NextResponse.json({ data: items });
  } catch (err: unknown) {
    console.error("[telegram/feeds/review] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const chatId = typeof body.chatId === "string" ? body.chatId : "";
    const messageId = typeof body.messageId === "number" ? body.messageId : NaN;
    const action = body.action === "ignore" || body.action === "retry" ? body.action : null;
    if (!chatId || !Number.isInteger(messageId) || !action) {
      return NextResponse.json({ error: "chatId, messageId and action are required." }, { status: 400 });
    }
    // Ownership: the row must be visible through the policy before it is touched.
    const { data: mine } = await supabase
      .from("telegram_feed_messages")
      .select("chat_id, message_id, thread_id, reply_to_message_id, sender, sender_id, text, posted_at, edited")
      .eq("chat_id", chatId)
      .eq("message_id", messageId)
      .maybeSingle();
    if (!mine) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const admin = createAdminClient();
    if (action === "retry") {
      // The same message through the listener again: the trade it needed may
      // have arrived since, or the write that failed may succeed now.
      const outcome = await ingestFeedMessage(
        feedStore(admin),
        {
          chatId, messageId, threadId: (mine.thread_id as number | null) ?? null,
          replyToMessageId: (mine.reply_to_message_id as number | null) ?? null,
          text: (mine.text as string | null) ?? "", sender: (mine.sender as string | null) ?? null,
          senderId: (mine.sender_id as number | null) ?? null, postedAt: mine.posted_at as string, edited: false,
        },
        new Date(),
        { force: true },
      );
      return NextResponse.json({ data: { chatId, messageId, outcome } });
    }
    const { error: updateError } = await admin
      .from("telegram_feed_messages")
      .update({ status: "ignored", reason: "ignored by a person" })
      .eq("chat_id", chatId)
      .eq("message_id", messageId);
    if (updateError) return NextResponse.json({ error: "Couldn't update." }, { status: 503 });
    return NextResponse.json({ data: { chatId, messageId } });
  } catch (err: unknown) {
    console.error("[telegram/feeds/review] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
