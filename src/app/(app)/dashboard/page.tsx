import Link from "next/link";
import { BookOpen, MessageSquare, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { DashboardCharts } from "@/components/analytics/dashboard-charts";
import { StatsCards } from "@/components/analytics/stats-cards";
import { OnboardingPrompt } from "@/components/chat/onboarding-prompt";
import { PerformanceCalendar } from "@/components/analytics/performance-calendar";
import { WelcomeCard } from "@/components/dashboard/welcome-card";
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
    return <EmptyAuthState />;
  }

  // Dashboard stats are scoped to the **active journal** (not the user's
  // authored trades) so shared workspaces show every member's contributions.
  const { journal: activeJournal } = await getActiveJournal(supabase, user.id);

  // Fetch trades and profile in parallel
  const [tradesResult, profileResult] = await Promise.all([
    supabase
      .from("trades")
      .select("*")
      .eq("journal_id", activeJournal.id)
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
        <StatsCards trades={[]} />
        <GettingStarted />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <WelcomeCard name={fullName} role={role} tradeCount={trades.length} />
      {/* DashboardCharts already renders StatsCards with filter-aware trades */}
      <DashboardCharts
        trades={trades}
        journalName={activeJournal.name}
        journalColor={activeJournal.color}
      />
      <PerformanceCalendar trades={trades} />
      <RecentTrades trades={trades} />
    </div>
  );
}

interface GettingStartedStep {
  readonly title: string;
  readonly icon: React.ElementType;
  readonly desc: string;
  readonly href: string;
  readonly cta: string;
  readonly highlight?: boolean;
}

const gettingStartedSteps: readonly GettingStartedStep[] = [
  {
    title: "Log Your First Trade",
    icon: BookOpen,
    desc: "Manually add a trade from your journal",
    href: "/journal/new",
    cta: "Go to Journal",
  },
  {
    title: "Try AI Trade Chat",
    icon: MessageSquare,
    desc: "Describe your trades in plain English and let AI log them",
    href: "/ai-chat",
    cta: "Open AI Chat",
    highlight: true,
  },
  {
    title: "Import from MT5",
    icon: Upload,
    desc: "Connect MetaTrader 5 to auto-sync your trades",
    href: "/journal",
    cta: "Learn More",
  },
];

function GettingStarted() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-base font-semibold text-foreground">Get Started</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        3 ways to add your trades
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {gettingStartedSteps.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            className={cn(
              "group flex flex-col gap-2 rounded-lg border p-4 transition-all hover:shadow-sm",
              step.highlight
                ? "border-primary/30 bg-primary/5 hover:border-primary/50"
                : "border-border bg-muted/50 hover:bg-accent"
            )}
          >
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                step.highlight ? "bg-primary/15" : "bg-muted"
              )}
            >
              <step.icon
                className={cn(
                  "size-4",
                  step.highlight ? "text-primary" : "text-muted-foreground"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.desc}</p>
            </div>
            <span
              className={cn(
                "mt-auto text-xs font-medium",
                step.highlight ? "text-primary" : "text-muted-foreground"
              )}
            >
              {step.cta} →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function RecentTrades({ trades }: { readonly trades: readonly Trade[] }) {
  const recent = trades.slice(-5).reverse(); // last 5 most recent
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">Recent Trades</h3>
      </div>
      <div className="divide-y divide-border">
        {recent.map((trade) => (
          <div
            key={trade.id}
            className="flex items-center justify-between px-5 py-3"
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "size-2 rounded-full",
                  trade.direction === "buy" ? "bg-emerald-400" : "bg-red-400"
                )}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {trade.instrument}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(trade.entry_time).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  "text-sm font-semibold",
                  trade.pnl_absolute === null
                    ? "text-muted-foreground"
                    : trade.pnl_absolute >= 0
                      ? "text-emerald-500"
                      : "text-red-400"
                )}
              >
                {trade.pnl_absolute !== null
                  ? `${trade.pnl_absolute >= 0 ? "+" : ""}${trade.pnl_absolute.toFixed(2)}`
                  : "Open"}
              </p>
              <p className="text-xs capitalize text-muted-foreground">
                {trade.direction}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-5 py-3">
        <Link
          href="/journal"
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          View all trades →
        </Link>
      </div>
    </div>
  );
}

function EmptyAuthState() {
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
