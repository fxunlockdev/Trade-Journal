import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { PostersClient } from "@/components/posters/posters-client";
import {
  ReportActivity,
  type DeliverySummary,
} from "@/components/posters/report-activity";
import { isoDate, zonedNow, type Cadence } from "@/lib/reports/periods-tz";
import { lookbackCutoffIso } from "@/lib/posters/scope";
import type { Journal, JournalRole, JournalWithRole, ReportDesk, Trade } from "@/types/database";

// A poster is a public claim about performance, so it must never be built from
// a cached render — every load re-reads the journals and their trades.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Posters | FX Unlock",
};

/**
 * See `lookbackCutoffIso` for why the read is bounded at all. 75 days covers
 * the longest selectable period ("last month", ~62 days back) with margin for
 * timezone slop, while keeping the row count well clear of the ceiling now
 * that several journals share one query.
 */
const LOOKBACK_DAYS = 75;

/**
 * Matches hosted Supabase's default max-rows. Asking for more than the server
 * will return just hides the truncation, so the cap is explicit and a full
 * page is reported to the user.
 */
const ROW_CAP = 1000;

export default async function PostersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Membership is the authorization boundary — the same pattern the Portfolio
  // view uses. RLS client for the memberships, admin client for the trades.
  const [membershipResult, activeResult] = await Promise.allSettled([
    supabase
      .from("journal_members")
      .select("role, journals!inner(*)")
      .eq("user_id", user.id),
    getActiveJournal(supabase, user.id),
  ]);

  type MembershipRow = { readonly role: JournalRole; readonly journals: Journal };
  const journals: JournalWithRole[] = (
    membershipResult.status === "fulfilled"
      ? ((membershipResult.value.data as unknown as MembershipRow[]) ?? [])
      : []
  )
    .filter((r) => !r.journals.is_archived)
    .map((r) => ({ ...r.journals, my_role: r.role }))
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    );

  const activeJournalId =
    activeResult.status === "fulfilled"
      ? activeResult.value.journal.id
      : (journals[0]?.id ?? null);

  // A PostgREST failure RESOLVES with { data: null, error } — it does not
  // reject — so without this an unreadable membership list looks identical to
  // "you belong to no journals", and the page tells the user their trading was
  // empty when in fact the read failed.
  let loadError: string | null = null;
  if (membershipResult.status === "rejected") {
    loadError = String(membershipResult.reason);
  } else if (membershipResult.value.error) {
    loadError = membershipResult.value.error.message;
  }
  if (loadError) {
    console.error("[TRDR] Posters journals error:", loadError);
  }

  const journalIds = journals.map((j) => j.id);
  let trades: Trade[] = [];

  if (journalIds.length > 0) {
    const cutoff = lookbackCutoffIso(LOOKBACK_DAYS);

    // Admin client for the trades read — SSR auth is flaky on Vercel, and
    // membership is already verified above. Filtered strictly to those journal
    // ids so no unauthorized rows can leak.
    //
    // The `or` matters: a trade opened months ago but CLOSED last week belongs
    // in a recent poster, and an entry-time bound alone would drop it. A trade
    // with no recorded close time falls back to its entry time for bucketing
    // anyway, so the filter and the bucketing agree on what can appear.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("trades")
      // Only what the poster maths and the trade log read. `select("*")`
      // shipped ~70 columns per row — including notes and tags — for every
      // journal, on a page that only rasterises an image.
      .select(
        "id, journal_id, instrument, asset_type, direction, entry_price, exit_price, quantity, stop_loss, take_profit, tp1, tp2, tp3, tp4, tp5, tp6, tp7, tp1_result, tp2_result, tp3_result, tp4_result, tp5_result, tp6_result, tp7_result, pnl_absolute, r_multiple, risk_reward_ratio, entry_time, exit_time",
      )
      .in("journal_id", journalIds)
      .not("pnl_absolute", "is", null)
      .or(`entry_time.gte.${cutoff},exit_time.gte.${cutoff}`)
      .order("entry_time", { ascending: false })
      .limit(ROW_CAP);

    if (error) {
      console.error("[TRDR] Posters trades error:", error.message);
      loadError = error.message;
    }
    trades = (data ?? []) as Trade[];

    // Hosted Supabase applies its own max-rows ceiling, and `.limit()` cannot
    // raise it — so a full page is indistinguishable from a truncated one.
    // Say so rather than let a truncated read understate the pip total on
    // something the user is about to publish.
    if (!error && trades.length >= ROW_CAP) {
      loadError = `Only the most recent ${ROW_CAP} trades were read, so totals for older periods may be incomplete.`;
    }
  }

  // Desks name and brand a journal COMBINATION. Read through the RLS client:
  // report_desks has real policies scoped to the owner, unlike trades.
  const { data: deskRows, error: desksError } = await supabase
    .from("report_desks")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  // Reported, not swallowed. Every other read on this page surfaces its
  // failure; a silent one here (a migration not yet applied, say) would leave
  // every desk-branded poster quietly falling back to its derived name with
  // nothing on screen admitting why.
  if (desksError) {
    console.error("[TRDR] Posters desks error:", desksError.message);
    loadError =
      loadError ??
      "Couldn't load your saved desks, so posters are using their default names.";
  }

  const { data: destination } = await supabase
    .from("telegram_destinations")
    .select("chat_id, chat_title, status, last_error")
    .maybeSingle();

  const desks = (deskRows ?? []) as ReportDesk[];

  // What the scheduler has actually done. RLS-scoped, so these are the
  // caller's own deliveries. Read here rather than in the client because the
  // page is already force-dynamic and one round trip beats a loading state on
  // information that answers "is it broken?".
  const { data: deliveryRows } = await supabase
    .from("report_deliveries")
    .select(
      "status, message_ids, attempted_styles, sent_at, updated_at, error, report_snapshots!inner(desk_id, cadence, period_start)",
    )
    // Ordered by updated_at, which is ALWAYS set. sent_at is null for every
    // failed and in-doubt delivery, so ordering by it would push recent
    // failures past the limit and out of the page entirely.
    .order("updated_at", { ascending: false })
    .limit(60);

  type DeliveryRow = {
    readonly status: string;
    readonly message_ids: unknown;
    readonly attempted_styles: readonly string[] | null;
    readonly sent_at: string | null;
    readonly updated_at: string;
    readonly error: string | null;
    readonly report_snapshots: {
      readonly desk_id: string;
      readonly cadence: string;
      readonly period_start: string;
    };
  };

  const deliveries: DeliverySummary[] = ((deliveryRows ?? []) as unknown as DeliveryRow[]).map(
    (r) => ({
      deskId: r.report_snapshots.desk_id,
      cadence: r.report_snapshots.cadence as Cadence,
      periodStart: r.report_snapshots.period_start,
      status: r.status,
      images: Array.isArray(r.message_ids) ? r.message_ids.length : 0,
      attempted: r.attempted_styles?.length ?? 0,
      sentAt: r.sent_at,
      updatedAt: r.updated_at,
      error: r.error,
    }),
  );

  // Latest close per setup, from the trades already read. Derived here rather
  // than queried again: this is the number behind "nothing will publish until
  // newer trades are imported", which is the single most common reason the
  // group stays quiet.
  const lastTradeByDesk: Record<string, string | null> = {};

  // The desk's OWN zone, through the same Intl path the periods use. Slicing
  // the UTC string would put a late trade on the previous day for any desk
  // ahead of UTC, which is every desk here.
  const localDay = (iso: string, tz: string): string =>
    isoDate(zonedNow(new Date(iso), tz));

  for (const desk of desks) {
    const ids = new Set(desk.journal_ids);
    let latestIso: string | null = null;
    for (const t of trades) {
      if (!ids.has(t.journal_id)) continue;
      const closed = t.exit_time ?? t.entry_time;
      if (closed && (latestIso === null || closed > latestIso)) latestIso = closed;
    }
    lastTradeByDesk[desk.id] = latestIso
      ? localDay(latestIso, desk.timezone)
      : null;
  }

  // `trades` is bounded to 75 days, so a desk whose last trade is older reads
  // as null here and the panel would state "no closed trades in these
  // journals" as fact, next to a partner-facing channel, while the journals
  // are simply quiet. A second unbounded lookup runs for exactly those desks,
  // so null always means none. Usually there are none, so this costs nothing.
  const unknown = desks.filter((d) => lastTradeByDesk[d.id] === null);
  if (unknown.length > 0) {
    const olderAdmin = createAdminClient();
    await Promise.all(
      unknown.map(async (desk) => {
        const { data } = await olderAdmin
          .from("trades")
          .select("entry_time, exit_time")
          .in("journal_id", desk.journal_ids)
          .not("pnl_absolute", "is", null)
          .order("entry_time", { ascending: false })
          .limit(1);
        const row = data?.[0];
        const closed = row ? (row.exit_time ?? row.entry_time) : null;
        if (closed) lastTradeByDesk[desk.id] = localDay(closed, desk.timezone);
      }),
    );
  }

  return (
    <>
      <PostersClient
        destination={destination ?? null}
        trades={trades}
        journals={journals}
        desks={desks}
        activeJournalId={activeJournalId}
        loadError={loadError}
      />
      <div className="mx-auto w-full max-w-md px-4 pb-10 lg:max-w-sm">
        <ReportActivity
          desks={desks}
          deliveries={deliveries}
          lastTradeByDesk={lastTradeByDesk}
          connected={destination?.status === "connected"}
          now={new Date().toISOString()}
        />
      </div>
    </>
  );
}
