import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeRenderer, renderPoster } from "@/lib/reports/render";
import { POSTER_TEMPLATES, getTemplate } from "@/lib/posters/templates";
import {
  sendTelegramAlbum,
  TelegramSendError,
  type TelegramPhoto,
} from "@/lib/telegram/media";
import { buildCaption, type Cadence } from "@/lib/reports/caption";
import { formatPeriodLabel } from "@/lib/reports/periods-tz";
import type { ReportMetrics } from "@/lib/reports/metrics";

/**
 * Rendering a frozen report and posting it, once.
 *
 * Shared by the button, the scheduler and the Telegram commands. It lives here
 * rather than in a route because the alternative is three implementations of
 * "post to the group", and they would only have to disagree once about the
 * claim or the in-doubt rule to put a second album in front of partners.
 *
 * AUTHORISATION IS THE CALLER'S JOB. This function takes an already-resolved
 * snapshot, desk name and destination, and assumes the caller has proved they
 * belong together and to the same owner. The button proves it with RLS; the
 * scheduler proves it by deriving all three from the same desk row.
 */

export interface PublishInput {
  readonly admin: SupabaseClient;
  readonly snapshot: {
    readonly id: string;
    readonly cadence: string;
    readonly period_start: string;
    readonly period_end: string;
    readonly metrics: unknown;
  };
  readonly deskName: string;
  /** Which styles this setup publishes. Empty falls back to all of them, so a
   *  row written before appearance existed still produces a full album. */
  readonly templateIds?: readonly string[];
  readonly destination: {
    readonly id: string;
    readonly chat_id: string;
    readonly chat_title: string | null;
  };
  readonly botToken: string;
  readonly appUrl: string;
  /** Milliseconds of invocation budget left, checked before the upload. */
  readonly msLeft: () => number;
}

export type PublishStatus =
  | "sent"
  | "already"
  | "failed"
  | "in_doubt"
  | "not_recorded";

export interface PublishOutcome {
  readonly status: PublishStatus;
  readonly posted?: number;
  readonly skipped?: readonly string[];
  readonly chat?: string | null;
  readonly messageIds?: readonly number[];
  readonly error?: string;
}

export async function publishSnapshot(
  input: PublishInput,
): Promise<PublishOutcome> {
  const { admin, snapshot, destination } = input;

  // CLAIM BEFORE SENDING, in one statement.
  //
  // Read-then-write cannot make this safe: two callers both read "not sent
  // yet", both write, and both post. The claim is an INSERT .. ON CONFLICT DO
  // UPDATE .. WHERE that takes a row lock, so exactly one caller is let
  // through. Null means already sent, in doubt, or another attempt holds it.
  const { data: deliveryId, error: claimError } = await admin.rpc(
    "claim_report_delivery",
    {
      p_snapshot_id: snapshot.id,
      p_chat_id: destination.chat_id,
      p_destination_id: destination.id,
    },
  );

  if (claimError) {
    return { status: "failed", error: "Could not claim this report." };
  }
  if (!deliveryId) {
    return { status: "already", chat: destination.chat_title };
  }

  // From here the row is claimed, so every exit must record an outcome.
  let sendStarted = false;
  try {
    // Built inside the claimed block: `metrics` is unvalidated jsonb, and a
    // shape mismatch escaping this try would wedge the row with no error.
    const caption = buildCaption({
      deskName: input.deskName,
      cadence: snapshot.cadence as Cadence,
      periodLabel: formatPeriodLabel({
        cadence: snapshot.cadence as Cadence,
        start: snapshot.period_start,
        end: snapshot.period_end,
      }),
      metrics: snapshot.metrics as ReportMetrics,
    });

    // Resolved through getTemplate so an id that no longer exists degrades to
    // a known template rather than throwing mid-album.
    const chosen =
      input.templateIds && input.templateIds.length > 0
        ? input.templateIds.map(getTemplate)
        : POSTER_TEMPLATES;

    const photos: TelegramPhoto[] = [];
    const skipped: string[] = [];
    try {
      // Sequential, sharing one browser: three tabs at once on a 1GB lambda is
      // how a render turns into an out-of-memory kill with no error.
      for (const template of chosen) {
        try {
          const bytes = await renderPoster({
            snapshotId: snapshot.id,
            style: template.id,
            appUrl: input.appUrl,
          });
          photos.push({
            bytes,
            filename: `${template.label.toLowerCase().replace(/\s+/g, "-")}.png`,
          });
        } catch (err: unknown) {
          // One broken style must not cost the other two.
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
    // claim sees a stale pending WITH send_started_at set and refuses to hand
    // it back out, because the album may already be in the group.
    //
    // `attempted_styles` records what this send SET OUT to publish. Without it
    // a short album cannot be explained after the fact: two message ids could
    // mean one style failed or that only two were ever chosen, and the setup
    // may have been edited since. It is the intent, so it is written here
    // rather than derived from the desk later.
    sendStarted = true;
    await admin
      .from("report_deliveries")
      .update({
        send_started_at: new Date().toISOString(),
        attempted_styles: chosen.map((t) => t.id),
      })
      .eq("id", deliveryId);

    const sent = await sendTelegramAlbum(
      input.botToken,
      destination.chat_id,
      photos,
      caption,
      input.msLeft(),
    );

    const { error: recordError } = await admin
      .from("report_deliveries")
      .update({
        status: "sent",
        message_ids: sent.messageIds,
        error: skipped.length > 0 ? skipped.join("; ") : null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);

    // Posted but not recorded. Reporting success would let a later run treat it
    // as unsent and publish it twice.
    if (recordError) {
      return {
        status: "not_recorded",
        posted: photos.length,
        chat: destination.chat_title,
        messageIds: sent.messageIds,
      };
    }

    return {
      status: "sent",
      posted: photos.length,
      skipped,
      chat: destination.chat_title,
      messageIds: sent.messageIds,
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : "Publish failed";

    // Could this have landed anyway? A clean refusal from Telegram is safe to
    // retry. Anything after the bytes started moving is not.
    const inDoubt =
      err instanceof TelegramSendError ? err.inDoubt : sendStarted;

    await admin
      .from("report_deliveries")
      .update({ status: inDoubt ? "in_doubt" : "failed", error: detail })
      .eq("id", deliveryId);

    return {
      status: inDoubt ? "in_doubt" : "failed",
      error: detail,
      chat: destination.chat_title,
    };
  }
}
