import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { deleteChatMessage } from "@/lib/telegram/chat";
import { refreshSnapshot, type StoredSnapshot } from "@/lib/reports/ensure-snapshot";
import { publishSnapshot } from "@/lib/reports/publish";
import type { ReportDesk } from "@/types/database";

/**
 * Replace an album that is already in the chat, with the current figures.
 *
 * Two deliberate guards used to make this impossible together: the delivery
 * record refuses a second send, and the snapshot is frozen. Both are right for
 * anything automatic. But trades get corrected and imported late, so a
 * published report can become wrong, and refusing to ever refresh it made the
 * wrong version permanent.
 *
 * This is the way out, and it is reachable ONLY from a person. The scheduler
 * never calls it: replacing something partners have already seen is a decision,
 * not a retry.
 *
 * Order matters. The old album is deleted BEFORE the new one is drawn, so the
 * chat never briefly shows the same report twice with different numbers. If the
 * new send then fails, the delivery reads 'superseded' with nothing published,
 * which is visibly unfinished rather than quietly wrong.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

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

    // RLS-scoped throughout, so another owner's report is absent, not refused.
    const { data: snapshot } = await supabase
      .from("report_snapshots")
      .select("id, cadence, period_start, period_end, metrics, trade_count, status, desk_id")
      .eq("id", id)
      .maybeSingle();

    if (!snapshot) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { data: desk } = await supabase
      .from("report_desks")
      .select("*")
      .eq("id", snapshot.desk_id)
      .maybeSingle();

    if (!desk) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { data: destination } = await supabase
      .from("telegram_destinations")
      .select("id, chat_id, chat_title, owner_user_id")
      .eq("owner_user_id", user.id)
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!destination) {
      return NextResponse.json(
        { error: "No Telegram group is connected." },
        { status: 409 },
      );
    }

    const botToken = telegramBotToken();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!botToken || !appUrl) {
      return NextResponse.json(
        { error: "Telegram is not fully configured." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("report_deliveries")
      .select("id, status, message_ids, send_started_at, claimed_at")
      .eq("snapshot_id", id)
      .eq("chat_id", destination.chat_id)
      .maybeSingle();

    // WHICH STATES A PERSON MAY RESOLVE HERE.
    //
    // 'sent' is the obvious one: the numbers changed and the album is wrong.
    //
    // The other two are dead ends the scheduler deliberately will not touch,
    // because it cannot know what is in the chat. It refuses, correctly, and
    // then nothing else could act either, which left a report permanently
    // stuck. A PERSON can look at the chat, so a person gets the way out:
    //
    //   in_doubt        a send may or may not have landed
    //   pending, stale  an invocation died after the bytes started moving
    //
    // Both are resolved the same way: delete whatever we know we posted, then
    // publish once, deliberately.
    const STALE_MS = 15 * 60 * 1000;
    const claimedAt = existing?.claimed_at
      ? Date.parse(existing.claimed_at as string)
      : 0;
    const stuckPending =
      existing?.status === "pending" &&
      existing.send_started_at !== null &&
      Date.now() - claimedAt > STALE_MS;

    const resolvable =
      existing &&
      (existing.status === "sent" ||
        existing.status === "in_doubt" ||
        stuckPending);

    if (!resolvable) {
      // A live send is the one thing nobody may interrupt.
      if (existing?.status === "pending") {
        return NextResponse.json(
          { error: "A send is in progress. Give it a minute and try again." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error:
            "That report has not been posted here, so there is nothing to replace. Use Post to Telegram.",
        },
        { status: 409 },
      );
    }

    // 1. Recompute from the trades as they stand now.
    const refreshed = await refreshSnapshot(
      admin,
      desk as ReportDesk,
      snapshot as unknown as StoredSnapshot,
    );

    if (refreshed.kind === "empty") {
      return NextResponse.json(
        {
          error:
            "That period now has no closed trades. The posted report was left alone.",
        },
        { status: 409 },
      );
    }
    if (refreshed.kind === "error") {
      return NextResponse.json({ error: refreshed.message }, { status: 503 });
    }

    // 2. Remove the old album, BEFORE drawing the new one, so the chat never
    //    shows the same report twice with different numbers.
    const oldIds = Array.isArray(existing.message_ids)
      ? (existing.message_ids as number[])
      : [];
    let removed = 0;
    for (const messageId of oldIds) {
      if (await deleteChatMessage(botToken, destination.chat_id, messageId)) {
        removed += 1;
      }
    }

    // 3. Release the claim, recording WHY. 'superseded' is re-claimable;
    //    'sent' is not, which is what made this impossible before.
    await admin
      .from("report_deliveries")
      .update({
        status: "superseded",
        retracted_at: removed > 0 ? new Date().toISOString() : null,
        send_started_at: null,
        error:
          removed === oldIds.length
            ? null
            : `Replaced, but ${oldIds.length - removed} of ${oldIds.length} old images could not be deleted (Telegram allows this for about 48 hours).`,
      })
      .eq("id", existing.id as string);

    // 4. Publish the refreshed figures.
    const outcome = await publishSnapshot({
      admin,
      snapshot: refreshed.snapshot,
      deskName: desk.name,
      templateIds: desk.template_ids,
      destination,
      botToken,
      appUrl,
      msLeft,
    });

    if (outcome.status !== "sent") {
      return NextResponse.json(
        {
          error:
            outcome.status === "in_doubt"
              ? "The old album was removed but the new one did not send cleanly. Check the chat before retrying."
              : "The old album was removed but the new one could not be posted.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      data: {
        replaced: removed,
        oldImages: oldIds.length,
        posted: outcome.posted,
        tradeCount: refreshed.snapshot.trade_count,
        chat: destination.chat_title,
        ms: Date.now() - started,
      },
    });
  } catch (err: unknown) {
    console.error("[reports/republish] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
