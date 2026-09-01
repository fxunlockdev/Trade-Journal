import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { publishSnapshot } from "@/lib/reports/publish";

/**
 * Render a report's posters and post them to the owner's group, as one album.
 *
 * Node runtime and a raised duration for the same reason as the render route:
 * this starts a real Chromium, draws three 1080x1080 images, then uploads them.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Kept a little under `maxDuration` so the send can decide to give up before
 *  the platform decides for it. A kill mid-send is the in-doubt case. */
const BUDGET_MS = 280_000;

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const started = Date.now();
  const msLeft = (): number => BUDGET_MS - (Date.now() - started);

  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Every read below goes through the RLS-scoped client, never the admin one.
    // `report_snapshots`, `report_desks` and `telegram_destinations` each carry
    // an `owner_user_id = auth.uid()` select policy, so another tenant's rows
    // are not merely hidden, they are absent. That is what stops one customer's
    // figures reaching another customer's partners.
    const { data: snapshot, error: snapshotError } = await supabase
      .from("report_snapshots")
      .select(
        "id, cadence, period_start, period_end, metrics, trade_count, desk_id, owner_user_id",
      )
      .eq("id", id)
      .maybeSingle();

    // Fail CLOSED. A read error must never be read as "nothing published yet".
    if (snapshotError) {
      return NextResponse.json(
        { error: "Could not read that report. Nothing was posted." },
        { status: 503 },
      );
    }
    if (!snapshot) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (snapshot.trade_count === 0) {
      return NextResponse.json(
        { error: "That period had no closed trades, so there is nothing to post." },
        { status: 409 },
      );
    }

    const { data: desk } = await supabase
      .from("report_desks")
      .select("id, name, template_ids")
      .eq("id", snapshot.desk_id)
      .maybeSingle();

    if (!desk) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // The owner filter is redundant TODAY, because RLS already applies it. It
    // is here because the scheduled runner lands next and has no user session:
    // it will use the admin client, RLS will not apply, and an unfiltered
    // version of this query would then return an arbitrary tenant's group and
    // publish one firm's results into another firm's room. Written explicitly
    // so that refactor cannot silently open it.
    //
    // Ordered and limited rather than a bare maybeSingle(), which throws on a
    // second connected row and would turn a recoverable state into a 500.
    const { data: destination, error: destinationError } = await supabase
      .from("telegram_destinations")
      .select("id, chat_id, chat_title, owner_user_id")
      .eq("owner_user_id", snapshot.owner_user_id)
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (destinationError) {
      return NextResponse.json(
        { error: "Could not read the Telegram connection. Nothing was posted." },
        { status: 503 },
      );
    }
    if (!destination) {
      return NextResponse.json(
        {
          error:
            "No Telegram group is connected. Connect one on the Posters page first.",
        },
        { status: 409 },
      );
    }

    const botToken = telegramBotToken();
    if (!botToken) {
      return NextResponse.json(
        { error: "The Telegram bot is not configured." },
        { status: 503 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!appUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_URL is not configured." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();

    // The mechanics live in lib/reports/publish so the scheduler and the
    // Telegram commands run exactly the same claim, render, send and
    // in-doubt rules. Authorisation is this route's job and was done above,
    // by RLS: the snapshot, desk and destination all came back owner-scoped.
    const outcome = await publishSnapshot({
      admin,
      snapshot,
      deskName: desk.name,
      templateIds: desk.template_ids,
      destination,
      botToken,
      appUrl,
      msLeft,
    });

    if (outcome.status === "already") {
      return NextResponse.json(
        {
          error: `This report has already been posted to ${destination.chat_title}, a send is in progress, or a previous send needs checking.`,
        },
        { status: 409 },
      );
    }
    if (outcome.status === "not_recorded") {
      return NextResponse.json(
        {
          error:
            "The album posted but could not be recorded. Do not retry: check the group first.",
          data: { messageIds: outcome.messageIds },
        },
        { status: 500 },
      );
    }
    if (outcome.status === "in_doubt") {
      return NextResponse.json(
        {
          error:
            "The send did not complete cleanly and may have posted. Check the group before retrying.",
        },
        { status: 502 },
      );
    }
    if (outcome.status === "failed") {
      return NextResponse.json(
        { error: "Could not post the report. Nothing was published." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      data: {
        posted: outcome.posted,
        skipped: outcome.skipped,
        chat: outcome.chat,
        messageIds: outcome.messageIds,
        ms: Date.now() - started,
      },
    });
  } catch (err: unknown) {
    // Detail stays server-side: this string reaches the client and internal
    // messages (Postgres syntax, renderer internals) do not belong there.
    console.error("[reports/publish] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
