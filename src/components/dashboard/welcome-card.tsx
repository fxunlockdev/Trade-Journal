"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WelcomeCardProps {
  readonly name: string | null;
  readonly role: string;
  readonly tradeCount: number;
}

// Pick greeting on the CLIENT so the hour reflects the viewer's timezone.
// A server-rendered greeting uses the server's clock (UTC on Vercel), which
// shows "Good morning" to users in APAC who are actually having dinner.
function pickGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function WelcomeCard({ name, role, tradeCount }: WelcomeCardProps) {
  // Start with a neutral "Welcome" so SSR and first client render agree and
  // React doesn't flag a hydration mismatch. Swap in the real greeting on
  // mount once we have access to the browser's clock.
  const [greeting, setGreeting] = useState<string>("Welcome");

  useEffect(() => {
    // Intentional setState-in-effect: we MUST read the hour after mount so
    // the value comes from the viewer's clock, not the server's. Using a
    // lazy initializer would re-introduce the hydration mismatch we just
    // fixed. Disable the lint rule rather than silently break UX.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(pickGreeting(new Date().getHours()));
  }, []);

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
                  "border-border bg-muted text-muted-foreground",
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
        <Link
          href="/insights"
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          🧠 AI Insights
        </Link>
        <Link
          href="/risk-calculator"
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          🧮 Risk Calc
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
