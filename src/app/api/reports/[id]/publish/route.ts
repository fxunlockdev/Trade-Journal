import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeRenderer, renderPoster } from "@/lib/reports/render";
import { POSTER_TEMPLATES } from "@/lib/posters/templates";
import {
  sendTelegramAlbum,
  TelegramSendError,
  type TelegramPhoto,
} from "@/lib/telegram/media";
import { telegramBotToken } from "@/lib/telegram/config";
import { buildCaption, type Cadence } from "@/lib/reports/caption";
import { formatPeriodLabel } from "@/lib/reports/periods-tz";
import type { ReportMetrics } from "@/lib/reports/metrics";

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
      .select("id, name")
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

    // CLAIM BEFORE SENDING, in one statement.
    //
    // Read-then-write cannot make this safe: two callers both read "not sent
    // yet", both write, and both post the album. The claim is an INSERT .. ON
    // CONFLICT DO UPDATE .. WHERE that takes a row lock, so exactly one caller
    // is let through. Null means already sent, in doubt, or another attempt
    // holds it right now. In every one of those cases this caller must not
    // render and must not post.
    const { data: deliveryId, error: claimError } = await admin.rpc(
      "claim_report_delivery",
      {
        p_snapshot_id: id,
        p_chat_id: destination.chat_id,
        p_destination_id: destination.id,
      },
    );

    if (claimError) {
      return NextResponse.json(
        { error: "Could not claim this report for sending." },
        { status: 503 },
      );
    }
    if (!deliveryId) {
      return NextResponse.json(
        {
          error: `This report has already been posted to ${destination.chat_title}, a send is in progress, or a previous send needs checking.`,
        },
        { status: 409 },
      );
    }

    // From here the row is claimed, so EVERY exit has to record an outcome.
    // Nothing between the claim and this try may throw, which is why the
    // caption is built inside it: `metrics` is unvalidated jsonb, and a shape
    // mismatch used to escape to the outer handler and wedge the row.
    let sendStarted = false;
    try {
      const caption = buildCaption({
        deskName: desk.name,
        cadence: snapshot.cadence as Cadence,
        periodLabel: formatPeriodLabel({
          cadence: snapshot.cadence as Cadence,
          start: snapshot.period_start,
          end: snapshot.period_end,
        }),
        metrics: snapshot.metrics as unknown as ReportMetrics,
      });

      const photos: TelegramPhoto[] = [];
      const skipped: string[] = [];
      try {
        // Sequential, sharing one browser: three tabs at once on a 1GB lambda
        // is how a render turns into an out-of-memory kill with no error.
        for (const template of POSTER_TEMPLATES) {
          try {
            const bytes = await renderPoster({
              snapshotId: id,
              style: template.id,
              appUrl,
            });
            photos.push({
              bytes,
              filename: `${template.label.toLowerCase().replace(/\s+/g, "-")}.png`,
            });
          } catch (err: unknown) {
            // One broken style must not cost the other two. Recorded against
            // the delivery below so a partial album is visible rather than
            // looking like a clean send.
            skipped.push(
              `${template.label}: ${err instanceof Error ? err.message : "render failed"}`,
            );
          }
        }
      } finally {
        await closeRenderer();
      }

      if (photos.length === 0) {
        throw new Error(`No poster rendered. ${skipped.join("; ")}`);
      }

      // Marked BEFORE the bytes move. If this invocation dies from here on, the
      // claim function sees a stale pending WITH send_started_at set and
      // refuses to re-claim it, because the album may already be in the group.
      sendStarted = true;
      await admin
        .from("report_deliveries")
        .update({ send_started_at: new Date().toISOString() })
        .eq("id", deliveryId);

      const sent = await sendTelegramAlbum(
        botToken,
        destination.chat_id,
        photos,
        caption,
        msLeft(),
      );

      const { error: recordError } = await admin
        .from("report_deliveries")
        .update({
          status: "sent",
          message_ids: sent.messageIds,
          // A partial album is a successful send with a gap worth keeping.
          error: skipped.length > 0 ? skipped.join("; ") : null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);

      // Posted but not recorded. Saying 200 here would let a later run treat it
      // as unsent and publish it twice, so it is surfaced as the problem it is.
      if (recordError) {
        return NextResponse.json(
          {
            error:
              "The album posted but could not be recorded. Do not retry: check the group first.",
            data: { messageIds: sent.messageIds },
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        data: {
          posted: photos.length,
          skipped,
          chat: destination.chat_title,
          messageIds: sent.messageIds,
          ms: Date.now() - started,
        },
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "Publish failed";

      // Could this have landed anyway? A clean refusal from Telegram is safe
      // to retry. Anything after the bytes started moving is not, and gets a
      // state the claim function will never hand back out.
      const inDoubt =
        err instanceof TelegramSendError ? err.inDoubt : sendStarted;

      await admin
        .from("report_deliveries")
        .update({ status: inDoubt ? "in_doubt" : "failed", error: detail })
        .eq("id", deliveryId);

      return NextResponse.json(
        {
          error: inDoubt
            ? "The send did not complete cleanly and may have posted. Check the group before retrying."
            : "Could not post the report. Nothing was published.",
        },
        { status: 502 },
      );
    }
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
