import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourcesFor, feedsFor, mayWriteJournal } from "@/lib/telegram/feed-api";

/**
 * Signal rooms the bot listens in, per person.
 *
 * A feed maps a room (or one topic of it) to a journal. Only a room this
 * person has proven they are in (a claim code posted there) can be listened
 * to, and only into a journal they can write to; the trades are theirs.
 */
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const [feeds, sources] = await Promise.all([feedsFor(supabase, user.id), sourcesFor(supabase, user.id)]);
    return NextResponse.json({ data: { feeds, sources } });
  } catch (err: unknown) {
    console.error("[telegram/feeds] unexpected:", err);
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
    const threadId = typeof body.threadId === "number" && Number.isInteger(body.threadId) && body.threadId > 0 ? body.threadId : null;
    const journalId = typeof body.journalId === "string" ? body.journalId : "";
    const defaultLots = typeof body.defaultLots === "number" && body.defaultLots > 0 && body.defaultLots <= 1000 ? body.defaultLots : null;
    const title = typeof body.title === "string" ? body.title.slice(0, 120) : null;
    if (!chatId || !journalId || defaultLots === null) {
      return NextResponse.json({ error: "A room, a journal and a size in lots are required." }, { status: 400 });
    }

    const sources = await sourcesFor(supabase, user.id);
    const source = sources.find((s) => s.chatId === chatId);
    if (!source) return NextResponse.json({ error: "Post the code in that room first." }, { status: 403 });
    if (threadId !== null && !source.topics.some((t) => t.threadId === threadId)) {
      return NextResponse.json({ error: "That topic hasn't been seen yet." }, { status: 400 });
    }
    if (!(await mayWriteJournal(supabase, user.id, journalId))) {
      return NextResponse.json({ error: "You can't write to that journal." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error: insertError } = await admin
      .from("telegram_feeds")
      .insert({ chat_id: chatId, thread_id: threadId, title, journal_id: journalId, user_id: user.id, default_lots: defaultLots })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") return NextResponse.json({ error: "That room is already connected." }, { status: 409 });
      return NextResponse.json({ error: "Couldn't connect the room." }, { status: 503 });
    }
    return NextResponse.json({ data: { id: data.id } }, { status: 201 });
  } catch (err: unknown) {
    console.error("[telegram/feeds] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
