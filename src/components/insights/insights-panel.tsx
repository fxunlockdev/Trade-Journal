"use client";

import { useEffect, useState } from "react";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Target,
  RefreshCw,
  Loader2,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  TradeInsightsResult,
  InsightMistake,
  InsightSuggestion,
  InsightPattern,
} from "@/lib/insights/prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsightsPanelProps {
  readonly userId: string;
  readonly tradeCount: number;
  readonly cached: {
    readonly insights: TradeInsightsResult;
    readonly stats_snapshot: Record<string, unknown>;
    readonly trades_analyzed: number;
    readonly generated_at: string;
  } | null;
}

interface PanelState {
  readonly loading: boolean;
  readonly insights: TradeInsightsResult | null;
  readonly error: string | null;
  readonly tradesAnalyzed: number;
  readonly generatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Score ring
// ---------------------------------------------------------------------------

const RING_RADIUS = 38;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function scoreColor(score: number): string {
  if (score >= 70) return "#10b981"; // emerald-500
  if (score >= 50) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

function ScoreRing({ score }: { readonly score: number }) {
  const fill = (score / 100) * RING_CIRCUMFERENCE;
  const gap = RING_CIRCUMFERENCE - fill;
  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative flex items-center justify-center">
        <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
          <circle
            cx="48"
            cy="48"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted/30"
          />
          <circle
            cx="48"
            cy="48"
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${fill} ${gap}`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className="absolute text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {score}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">/100</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function MistakeSeverityBadge({
  severity,
}: {
  readonly severity: InsightMistake["severity"];
}) {
  if (severity === "critical") {
    return <Badge variant="destructive">critical</Badge>;
  }
  if (severity === "warning") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/30 bg-amber-500/10 text-amber-400"
      >
        warning
      </Badge>
    );
  }
  return <Badge variant="outline">info</Badge>;
}

function PriorityBadge({
  priority,
}: {
  readonly priority: InsightSuggestion["priority"];
}) {
  if (priority === "high") {
    return <Badge variant="destructive">HIGH</Badge>;
  }
  if (priority === "medium") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/30 bg-amber-500/10 text-amber-400"
      >
        MED
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      LOW
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function MistakesCard({
  mistakes,
}: {
  readonly mistakes: readonly InsightMistake[];
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="size-4 text-amber-400" />
          Key Mistakes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mistakes.map((m, idx) => (
          <div
            key={idx}
            className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center gap-2">
              <MistakeSeverityBadge severity={m.severity} />
              <span className="text-sm font-medium text-foreground">
                {m.title}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{m.description}</p>
            <p className="text-xs font-medium text-primary">
              Fix: {m.fix}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StrengthsCard({
  strengths,
}: {
  readonly strengths: readonly string[];
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-4 text-emerald-400" />
          Strengths
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {strengths.map((s, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-0.5 shrink-0 text-emerald-400">•</span>
              {s}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SuggestionsCard({
  suggestions,
}: {
  readonly suggestions: readonly InsightSuggestion[];
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Lightbulb className="size-4 text-yellow-400" />
          Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s, idx) => (
          <div key={idx} className="flex items-start gap-3">
            <PriorityBadge priority={s.priority} />
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">
                {s.title}
              </span>
              <span className="text-sm text-muted-foreground">
                {" — "}
                {s.action}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PatternsCard({
  patterns,
}: {
  readonly patterns: readonly InsightPattern[];
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TrendingUp className="size-4 text-primary" />
          Patterns Detected
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {patterns.map((p, idx) => (
          <div key={idx} className="space-y-1">
            <p className="text-sm font-medium text-foreground">{p.title}</p>
            <p className="text-xs text-muted-foreground">{p.insight}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FocusCard({ focus }: { readonly focus: string }) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="size-4 text-primary" />
          Focus This Week
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">{focus}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-9 w-36" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <Skeleton className="mb-4 h-24 w-24 rounded-full mx-auto" />
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="space-y-3 pt-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-border bg-card">
            <CardContent className="space-y-2 pt-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function InsightsPanel({
  userId: _userId,
  tradeCount,
  cached,
}: InsightsPanelProps) {
  const [state, setState] = useState<PanelState>({
    loading: false,
    insights: cached?.insights ?? null,
    error: null,
    tradesAnalyzed: cached?.trades_analyzed ?? 0,
    generatedAt: cached?.generated_at ?? null,
  });

  useEffect(() => {
    if (cached) {
      // This intentionally syncs panel state when the cached prop changes
      // upstream (e.g. after /api/insights cache revalidation). Deriving
      // this from `cached` every render would break the "stale but visible"
      // behavior we want while a new generation is in-flight.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((prev) => ({
        ...prev,
        insights: cached.insights,
        tradesAnalyzed: cached.trades_analyzed,
        generatedAt: cached.generated_at,
      }));
    }
  }, [cached]);

  async function handleGenerate() {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch("/api/insights", { method: "POST" });
      const json = (await res.json()) as {
        data?: {
          insights: TradeInsightsResult;
          trades_analyzed: number;
          generated_at: string;
        };
        error?: string;
      };

      if (!res.ok || !json.data) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: json.error ?? "Failed to generate insights",
        }));
        return;
      }

      setState({
        loading: false,
        insights: json.data.insights,
        error: null,
        tradesAnalyzed: json.data.trades_analyzed,
        generatedAt: json.data.generated_at,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unexpected error occurred";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }

  const formattedDate = state.generatedAt
    ? new Date(state.generatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  // Not enough trades
  if (tradeCount < 3) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Brain className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Not enough trades yet
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Log at least 3 trades to get personalized AI insights about your
            trading performance.
          </p>
          <p className="text-xs text-muted-foreground">
            {tradeCount} / 3 trades logged
          </p>
        </CardContent>
      </Card>
    );
  }

  // Loading
  if (state.loading) {
    return <InsightsSkeleton />;
  }

  // No insights yet
  if (!state.insights) {
    return (
      <div className="space-y-6">
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Brain className="size-7 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                AI Trade Coach
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Powered by GPT-5.4 — analyze your {tradeCount} trades for
                personalized insights
              </p>
            </div>
            {state.error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button onClick={handleGenerate} className="gap-2">
              <Zap className="size-4" />
              Analyze My Trading
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { insights } = state;
  // Use focus_next_week as the field name from the existing prompt type
  const focusText =
    (insights as TradeInsightsResult & { focus_this_week?: string })
      .focus_this_week ?? insights.focus_next_week;

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Brain className="size-5 text-primary" />
                AI Trade Coach
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Powered by GPT-5.4
                {formattedDate && (
                  <> · Last analyzed: {formattedDate}</>
                )}
                {state.tradesAnalyzed > 0 && (
                  <> · {state.tradesAnalyzed} trades</>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                onClick={handleGenerate}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={state.loading}
              >
                {state.loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Analyze My Trading
              </Button>
              {state.error && (
                <p className="text-xs text-destructive">{state.error}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Score + Summary */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <ScoreRing score={insights.score} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {insights.summary}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mistakes + Strengths */}
      <div className="grid gap-6 md:grid-cols-2">
        {insights.mistakes.length > 0 && (
          <MistakesCard mistakes={insights.mistakes} />
        )}
        {insights.strengths.length > 0 && (
          <StrengthsCard strengths={insights.strengths} />
        )}
      </div>

      {/* Suggestions */}
      {insights.suggestions.length > 0 && (
        <SuggestionsCard suggestions={insights.suggestions} />
      )}

      {/* Patterns + Focus */}
      <div className="grid gap-6 md:grid-cols-2">
        {insights.patterns.length > 0 && (
          <PatternsCard patterns={insights.patterns} />
        )}
        {focusText && <FocusCard focus={focusText} />}
      </div>
    </div>
  );
}
