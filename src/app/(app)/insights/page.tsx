import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { InsightsPanel } from "@/components/insights/insights-panel";
import type { TradeInsightsResult } from "@/lib/insights/prompt";

export const metadata = { title: "AI Insights | TRDR" };

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

  const adminDB = createAdminClient();

  const [countResult, cachedResult] = await Promise.all([
    adminDB
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
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
