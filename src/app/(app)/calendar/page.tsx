import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { MonthlyPnlCalendar } from "@/components/analytics/monthly-pnl-calendar";
import type { Trade } from "@/types/database";

// Mirror the dashboard: never serve a cached calendar — it renders mutable DB
// state, so a freshly logged trade must show up on the next request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Calendar | TRDR" };

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">
          Sign in to view your calendar
        </h2>
        <Link
          href="/login"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to login
        </Link>
      </div>
    );
  }

  // Scope to the active journal (not the author) so shared workspaces show
  // every member's trades — same access model as the dashboard.
  const { journal } = await getActiveJournal(supabase, user.id);

  // Admin client for the trades read — SSR auth is flaky on Vercel. Membership
  // is already verified by getActiveJournal and we filter strictly by
  // journal.id, so no unauthorized rows can leak.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("trades")
    .select("*")
    .eq("journal_id", journal.id)
    .order("entry_time", { ascending: true });

  if (error) {
    console.error("[TRDR] Calendar trades error:", error.message);
  }

  const trades = (data ?? []) as Trade[];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daily net P&amp;L and win rate for{" "}
          <span className="font-medium text-foreground">{journal.name}</span>.
          Green days made money, red days lost it.
        </p>
      </div>

      <MonthlyPnlCalendar trades={trades} />
    </div>
  );
}
