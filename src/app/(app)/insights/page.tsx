import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { InsightsPanel } from "@/components/insights/insights-panel";
import type { TradeInsightsResult } from "@/lib/insights/prompt";

export const metadata = { title: "AI Insights | TRDR" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CachedInsightsRow {
  readonly insights: TradeInsightsResult;
  readonly stats_snapshot: Record<string, unknown>;
  readonly trades_analyzed: number;
  readonly generated_at: string;
}

export default async function InsightsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Insights are scoped to the active journal. Trade count + cached results
  // both filter by `journal_id` so switching workspaces shows journal-specific
  // analysis, not a global one. NOTE: `trade_insights` cache is still keyed
  // by user_id for now — Phase 10 will re-key by (user_id, journal_id).
  const { journal: activeJournal } = await getActiveJournal(supabase, user.id);

  const adminDB = createAdminClient();

  const [countResult, cachedResult] = await Promise.all([
    adminDB
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("journal_id", activeJournal.id),
    adminDB
      .from("trade_insights")
      .select("*")
      .eq("user_id", user.id)
      .single(),
  ]);

  const tradeCount = countResult.count ?? 0;

  const cached =
    cachedResult.data && !cachedResult.error
      ? (cachedResult.data as CachedInsightsRow)
      : null;

  return (
    <div className="space-y-6 p-6">
      <InsightsPanel
        userId={user.id}
        tradeCount={tradeCount}
        cached={cached}
      />
    </div>
  );
}
