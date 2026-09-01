import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { dueCadences } from "@/lib/reports/schedule";
import { buildSnapshot } from "@/lib/reports/snapshot";
import { resolveReportPeriod } from "@/lib/reports/periods-tz";
import { publishSnapshot } from "@/lib/reports/publish";
import type { Cadence } from "@/lib/reports/periods-tz";
import type { ReportDesk, Trade } from "@/types/database";

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

const EDGE_DAYS = 3;

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

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
        .select("id, chat_id, chat_title")
        .eq("owner_user_id", desk.owner_user_id)
        .eq("status", "connected")
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!destination) continue;

      for (const cadence of due) {
        if (msLeft() < PER_DESK_MS) break;

        const period = resolveReportPeriod(cadence as Cadence, now, desk.timezone);

        // Cheap check before expensive work. Without it every tick from 06:00
        // to midnight would render three posters just to have the claim refuse
        // them: correct, but 70 wasted Chromium starts per desk per day.
        const { data: already } = await admin
          .from("report_deliveries")
          .select("id, report_snapshots!inner(desk_id, cadence, period_start)")
          .eq("chat_id", destination.chat_id)
          .eq("report_snapshots.desk_id", desk.id)
          .eq("report_snapshots.cadence", cadence)
          .eq("report_snapshots.period_start", period.start)
          .limit(1)
          .maybeSingle();

        if (already) continue;

        const { data: trades } = await admin
          .from("trades")
          .select("*")
          .in("journal_id", desk.journal_ids)
          .gte("entry_time", shiftIso(period.start, -365))
          .lte("entry_time", shiftIso(period.end, EDGE_DAYS));

        const draft = buildSnapshot(
          desk,
          cadence as Cadence,
          (trades ?? []) as Trade[],
          now,
        );

        // An empty period is skipped, not published. A poster reading zero
        // trades tells partners nothing and looks like a fault.
        if (draft.trade_count === 0) {
          results.push({ desk: desk.name, cadence, outcome: "skipped: no trades" });
          continue;
        }

        // Existing snapshot wins: its numbers are frozen and may already have
        // been rendered. Never recompute over one.
        const existing = await admin
          .from("report_snapshots")
          .select("id, cadence, period_start, period_end, metrics")
          .eq("desk_id", desk.id)
          .eq("cadence", cadence)
          .eq("period_start", draft.period_start)
          .eq("period_end", draft.period_end)
          .maybeSingle();

        let snapshot = existing.data;
        if (!snapshot) {
          const inserted = await admin
            .from("report_snapshots")
            .insert(draft)
            .select("id, cadence, period_start, period_end, metrics")
            .single();
          if (inserted.error || !inserted.data) {
            results.push({
              desk: desk.name,
              cadence,
              outcome: "failed",
              detail: "could not save the report",
            });
            continue;
          }
          snapshot = inserted.data;
        }

        const outcome = await publishSnapshot({
          admin,
          snapshot,
          deskName: desk.name,
          destination,
          botToken,
          appUrl,
          msLeft,
        });

        results.push({
          desk: desk.name,
          cadence,
          outcome: outcome.status,
          detail: outcome.error,
        });
      }
    }

    const sent = results.filter((r) => r.outcome === "sent").length;
    return NextResponse.json({
      data: { sent, considered: results.length, results, ms: Date.now() - started },
    });
  } catch (err: unknown) {
    console.error("[cron/reports] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error", data: { results } },
      { status: 500 },
    );
  }
}
