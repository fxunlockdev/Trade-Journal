import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken, telegramWebhookSecret } from "@/lib/telegram/config";
import { ensureWebhookRegistered } from "@/lib/telegram/registration";
import { dueCadences, periodsToConsider } from "@/lib/reports/schedule";
import { publishSnapshot } from "@/lib/reports/publish";
import { ensureSnapshot } from "@/lib/reports/ensure-snapshot";
import type { Cadence } from "@/lib/reports/periods-tz";
import type { ReportDesk } from "@/types/database";

/**
 * The morning run.
 *
 * Ticks every 15 minutes and asks "is anything due?" rather than firing at a
 * fixed instant, for two reasons:
 *
 *   BST. Vercel crons run in UTC, so 06:00 London is 05:00 UTC in summer and
 *   06:00 in winter. A fixed UTC trigger is an hour wrong for half the year.
 *
 *   Missed ticks. A single daily trigger that gets dropped means no report,
 *   and nobody finds out until a partner asks.
 *
 * Running often is safe because every step is idempotent: the snapshot is
 * unique per (desk, cadence, period) and the delivery claim refuses a second
 * send. So ~96 runs a day produce exactly one album per desk per period.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Left over for the response and cleanup after the last desk is handled. */
const BUDGET_MS = 280_000;

/** Enough for one desk's three renders plus the upload. Below this the run
 *  stops and leaves the rest to the next tick, rather than being killed
 *  mid-send, which is the in-doubt case. */
const PER_DESK_MS = 90_000;

/**
 * Most albums one tick may publish, across every desk.
 *
 * A backstop, not the main control: the `since` floor below is what stops a new
 * setup dumping history. This exists because the consequence of getting that
 * wrong lands in front of business partners, and a cap that occasionally delays
 * a report by fifteen minutes is a far cheaper mistake than a flood.
 */
const MAX_ALBUMS_PER_TICK = 4;

/**
 * Constant-time-ish comparison of the cron secret.
 *
 * This endpoint publishes to partner groups, so an unauthenticated caller must
 * not be able to trigger it. Vercel Cron sends the secret as a bearer token.
 */
function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const got = request.headers.get("authorization") ?? "";
  const want = `Bearer ${expected}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) {
    diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  }
  return diff === 0;
}

interface DeskResult {
  readonly desk: string;
  readonly cadence: string;
  readonly outcome: string;
  readonly detail?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const msLeft = (): number => BUDGET_MS - (Date.now() - started);

  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = telegramBotToken();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!botToken || !appUrl) {
    return NextResponse.json(
      { error: "Telegram or app URL is not configured." },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const now = new Date();
  const results: DeskResult[] = [];
  let published = 0;

  // Keep Telegram's webhook honest, before doing anything else.
  //
  // A stale registration fails SILENTLY: Telegram simply stops delivering the
  // update types it was not told about, which looks like a broken app and
  // cost a real user three claim codes that were never delivered. Twice that
  // meant asking a person to re-run a setup step after a deploy. Checking here
  // costs one API call a tick and removes that step for good.
  //
  // Deliberately not fatal: a Telegram hiccup must not stop the morning's
  // reports, which do not depend on the webhook at all.
  let webhook = "not checked";
  const secret = telegramWebhookSecret();
  if (secret) {
    const outcome = await ensureWebhookRegistered(admin, botToken, appUrl, secret);
    webhook = outcome.registered
      ? `re-registered (${outcome.reason})`
      : outcome.reason;
  }

  try {
    // Every owner's desks in one pass. This runs with no user session, so RLS
    // does not apply and each desk's OWN owner_user_id is what resolves its
    // destination below. Nothing here may reach across owners.
    const { data: desks, error: desksError } = await admin
      .from("report_desks")
      .select("*")
      .eq("is_active", true);

    if (desksError) {
      return NextResponse.json({ error: "Could not read desks." }, { status: 503 });
    }

    for (const desk of (desks ?? []) as ReportDesk[]) {
      if (published >= MAX_ALBUMS_PER_TICK) break;
      if (msLeft() < PER_DESK_MS) {
        results.push({
          desk: desk.name,
          cadence: "-",
          outcome: "deferred",
          detail: "out of time this tick",
        });
        continue;
      }

      const due = dueCadences(now, desk.timezone);
      if (due.length === 0) continue;

      // The destination is resolved from THIS DESK'S owner, never from a
      // shared lookup. Getting this wrong publishes one firm's results into
      // another firm's room, which is the worst failure this system has.
      const { data: destination } = await admin
        .from("telegram_destinations")
        .select("id, chat_id, chat_title, connected_at")
        .eq("owner_user_id", desk.owner_user_id)
        .eq("status", "connected")
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!destination) continue;

      // Publishing to THIS chat began at the later of the two: a setup made
      // last week against a chat connected today should not backfill the week.
      const since = new Date(
        Math.max(
          new Date(desk.created_at).getTime(),
          new Date(destination.connected_at ?? desk.created_at).getTime(),
        ),
      );

      for (const cadence of due) {
        if (published >= MAX_ALBUMS_PER_TICK) break;
        if (msLeft() < PER_DESK_MS) break;

        // OLDEST FIRST, and at most one per tick.
        //
        // A period is computed relative to now, so "yesterday's report" used to
        // get exactly one chance, the morning after. Journals here are filled
        // from broker PDFs in batches days behind, so that run found an empty
        // period, skipped it, and never came back: the report did not arrive
        // late, it never happened at all.
        //
        // Publishing one per tick means a backlog trickles out over an hour or
        // two in the order the days happened, rather than arriving as a wall of
        // images in front of partners.
        for (const candidate of periodsToConsider(
          cadence,
          now,
          desk.timezone,
          since,
        )) {
          if (msLeft() < PER_DESK_MS) break;

          // Cheap check before expensive work. Without it every tick would
          // render posters just to have the claim refuse them.
          const { data: already } = await admin
            .from("report_deliveries")
            .select("id, report_snapshots!inner(desk_id, cadence, period_start)")
            .eq("chat_id", destination.chat_id)
            .eq("report_snapshots.desk_id", desk.id)
            .eq("report_snapshots.cadence", cadence)
            .eq("report_snapshots.period_start", candidate.start)
            .limit(1)
            .maybeSingle();

          if (already) continue;

          // The candidate's own instant, so the snapshot is built for THAT day
          // rather than today.
          const ensured = await ensureSnapshot(
            admin,
            desk,
            cadence as Cadence,
            candidate.instant,
          );

          // An empty day is not worth a result line: with a week of lookback
          // that would be eight entries per desk per tick, every tick, drowning
          // anything real. Move on and try the next day.
          if (ensured.kind === "empty") continue;

          if (ensured.kind === "error") {
            results.push({
              desk: desk.name,
              cadence,
              outcome: "failed",
              detail: ensured.message,
            });
            break;
          }

          const outcome = await publishSnapshot({
            admin,
            snapshot: ensured.snapshot,
            deskName: desk.name,
            templateIds: desk.template_ids,
            destination,
            botToken,
            appUrl,
            msLeft,
          });

          published += 1;
          results.push({
            desk: desk.name,
            cadence: `${cadence} ${candidate.start}`,
            outcome: outcome.status,
            detail: outcome.error,
          });

          // One per tick per desk, whatever happened. A failure should not send
          // the loop on to publish a different day in its place.
          break;
        }
      }
    }

    const sent = results.filter((r) => r.outcome === "sent").length;
    return NextResponse.json({
      data: {
        sent,
        considered: results.length,
        webhook,
        results,
        ms: Date.now() - started,
      },
    });
  } catch (err: unknown) {
    console.error("[cron/reports] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error", data: { results } },
      { status: 500 },
    );
  }
}
