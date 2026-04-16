import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DashboardCharts } from "@/components/analytics/dashboard-charts";
import { OnboardingPrompt } from "@/components/chat/onboarding-prompt";
import type { Trade } from "@/types/database";

export const metadata = {
  title: "Dashboard | TRDR",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <EmptyState />;
  }

  // Fetch trades and profile in parallel
  const [tradesResult, profileResult] = await Promise.all([
    supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .order("entry_time", { ascending: true }),
    supabase
      .from("users")
      .select("has_onboarded")
      .eq("id", user.id)
      .single(),
  ]);

  if (tradesResult.error) {
    console.error("[TRDR] Dashboard trades error:", tradesResult.error.message);
  }

  const trades = (tradesResult.data ?? []) as Trade[];
  const hasOnboarded = profileResult.data?.has_onboarded ?? true;
  const showOnboarding = !hasOnboarded && trades.length === 0;

  if (trades.length === 0) {
    return (
      <div className="space-y-6 p-6">
        {showOnboarding && <OnboardingPrompt userId={user.id} />}
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="p-6">
      <DashboardCharts trades={trades} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="rounded-full bg-zinc-800 p-6">
        <svg
          className="h-10 w-10 text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-zinc-200">No trades yet</h2>
      <p className="max-w-sm text-center text-sm text-zinc-500">
        Start logging your trades to see performance analytics, equity curves,
        and detailed statistics.
      </p>
      <Link
        href="/journal/new"
        className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
      >
        Log your first trade
      </Link>
    </div>
  );
}
