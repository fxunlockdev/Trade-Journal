import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DashboardCharts } from "@/components/analytics/dashboard-charts";
import { OnboardingPrompt } from "@/components/chat/onboarding-prompt";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
      .select("has_onboarded, role, full_name")
      .eq("id", user.id)
      .single(),
  ]);

  if (tradesResult.error) {
    console.error("[TRDR] Dashboard trades error:", tradesResult.error.message);
  }

  const trades = (tradesResult.data ?? []) as Trade[];
  const hasOnboarded = profileResult.data?.has_onboarded ?? true;
  const role = profileResult.data?.role ?? "user";
  const fullName = profileResult.data?.full_name ?? null;
  const showOnboarding = !hasOnboarded && trades.length === 0;

  if (trades.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <WelcomeCard name={fullName} role={role} tradeCount={0} />
        {showOnboarding && <OnboardingPrompt userId={user.id} />}
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <WelcomeCard name={fullName} role={role} tradeCount={trades.length} />
      <DashboardCharts trades={trades} />
    </div>
  );
}

function WelcomeCard({
  name,
  role,
  tradeCount,
}: {
  name: string | null;
  role: string;
  tradeCount: number;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting}</p>
          <h2 className="mt-0.5 text-2xl font-bold text-foreground">
            {name ?? "Trader"} 👋
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "capitalize text-xs",
                role === "admin" &&
                  "border-destructive/30 bg-destructive/10 text-destructive",
                role === "trader" &&
                  "border-primary/30 bg-primary/10 text-primary",
                role === "user" &&
                  "border-border bg-muted text-muted-foreground"
              )}
            >
              {role}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {tradeCount} {tradeCount === 1 ? "trade" : "trades"} logged
            </span>
          </div>
        </div>
        <div className="text-3xl">📈</div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/journal/new"
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Log Trade
        </Link>
        <Link
          href="/ai-chat"
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          💬 AI Chat
        </Link>
        {(role === "trader" || role === "admin") && (
          <Link
            href="/signals/new"
            className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            📡 New Signal
          </Link>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="rounded-full bg-muted p-6">
        <svg
          className="h-10 w-10 text-muted-foreground"
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
      <h2 className="text-lg font-semibold text-foreground">No trades yet</h2>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        Start logging your trades to see performance analytics, equity curves,
        and detailed statistics.
      </p>
      <Link
        href="/journal/new"
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Log your first trade
      </Link>
    </div>
  );
}
