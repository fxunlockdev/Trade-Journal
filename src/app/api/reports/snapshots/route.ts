import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertJournalsAccessible } from "@/lib/reports/desk-access";
import { buildSnapshot } from "@/lib/reports/snapshot";
import { resolveReportPeriod } from "@/lib/reports/periods-tz";
import { isCadence, type Cadence } from "@/lib/telegram/commands";
import type { ReportDesk, Trade } from "@/types/database";

/**
 * Freeze one report's numbers, or return the frozen ones.
 *
 * Every way of publishing needs this first: the button, the scheduler, and the
 * Telegram commands. It exists once so all three agree on what "yesterday's
 * report for this desk" means, rather than three callers each resolving a
 * period slightly differently.
 *
 * Idempotent by (desk, cadence, period): asking twice returns the SAME row,
 * because the numbers a poster showed must not change under it between the
 * render and the send.
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Widened past the period so a trade CLOSED inside it but entered earlier is
 *  still fetched. Exact membership is decided by `tradesForDesk`, in the desk's
 *  own timezone; this bound only keeps the query from being unbounded. */
const EDGE_DAYS = 3;

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

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
    const deskId =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).deskId
        : undefined;
    const cadence =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).cadence
        : undefined;

    if (typeof deskId !== "string" || !UUID_RE.test(deskId)) {
      return NextResponse.json({ error: "A desk is required." }, { status: 400 });
    }
    if (typeof cadence !== "string" || !isCadence(cadence)) {
      return NextResponse.json(
        { error: "Cadence must be daily, weekly or monthly." },
        { status: 400 },
      );
    }

    // RLS scopes this to the caller, so another owner's desk is simply absent.
    const { data: desk, error: deskError } = await supabase
      .from("report_desks")
      .select("*")
      .eq("id", deskId)
      .maybeSingle();

    if (deskError) {
      return NextResponse.json(
        { error: "Couldn't read that desk." },
        { status: 503 },
      );
    }
    if (!desk) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 });
    }

    // Re-checked HERE, not trusted from desk creation. Membership can be
    // revoked after a desk is saved, and a desk naming a journal the caller can
    // no longer see must not still publish that book's results.
    const refusal = await assertJournalsAccessible(
      supabase,
      user.id,
      (desk as ReportDesk).journal_ids,
    );
    if (refusal) return refusal;

    const period = resolveReportPeriod(cadence as Cadence, new Date(), desk.timezone);

    // `trades` is deny-all RLS by design, so the admin client is the only way
    // to read it. The authorisation for this read is the membership check
    // above, which is the house pattern for every trades access path.
    const admin = createAdminClient();
    const { data: trades, error: tradesError } = await admin
      .from("trades")
      .select("*")
      .in("journal_id", (desk as ReportDesk).journal_ids)
      .gte("entry_time", shiftIso(period.start, -365))
      .lte("entry_time", shiftIso(period.end, EDGE_DAYS));

    if (tradesError) {
      return NextResponse.json(
        { error: "Couldn't read trades for that desk." },
        { status: 503 },
      );
    }

    const draft = buildSnapshot(
      desk as ReportDesk,
      cadence as Cadence,
      (trades ?? []) as Trade[],
      new Date(),
    );

    const COLUMNS = "id, status, trade_count, period_start, period_end, cadence";

    // FROZEN MEANS FROZEN.
    //
    // An upsert here would look right and be wrong: a merge overwrites
    // `metrics` with a fresh computation and resets `status`, so asking a
    // second time for a report that was already rendered and posted would
    // silently change the numbers underneath it. A poster in a partners' group
    // must keep meaning what it meant when it was published.
    //
    // So an existing snapshot is returned untouched, and only a genuinely new
    // period is written.
    const existing = await admin
      .from("report_snapshots")
      .select(COLUMNS)
      .eq("desk_id", deskId)
      .eq("cadence", cadence)
      .eq("period_start", draft.period_start)
      .eq("period_end", draft.period_end)
      .maybeSingle();

    if (existing.error) {
      return NextResponse.json(
        { error: "Couldn't read that report." },
        { status: 503 },
      );
    }
    if (existing.data) {
      return NextResponse.json({ data: existing.data, reused: true });
    }

    const { data: saved, error: saveError } = await admin
      .from("report_snapshots")
      .insert(draft)
      .select(COLUMNS)
      .single();

    if (saveError) {
      // 23505: another request created the same period between the select and
      // the insert. The unique index is the arbiter; read back what it kept.
      if (saveError.code === "23505") {
        const raced = await admin
          .from("report_snapshots")
          .select(COLUMNS)
          .eq("desk_id", deskId)
          .eq("cadence", cadence)
          .eq("period_start", draft.period_start)
          .eq("period_end", draft.period_end)
          .maybeSingle();
        if (raced.data) {
          return NextResponse.json({ data: raced.data, reused: true });
        }
      }
      return NextResponse.json(
        { error: "Couldn't save that report." },
        { status: 503 },
      );
    }

    return NextResponse.json({ data: saved, reused: false });
  } catch (err: unknown) {
    console.error("[reports/snapshots] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
