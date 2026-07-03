import type { TradingStats } from "./analyzer";

export interface InsightMistake {
  readonly title: string;
  readonly description: string;
  readonly severity: "critical" | "warning" | "info";
  readonly fix: string;
}

export interface InsightSuggestion {
  readonly title: string;
  readonly action: string;
  readonly priority: "high" | "medium" | "low";
}

export interface InsightPattern {
  readonly title: string;
  readonly insight: string;
}

export interface TradeInsightsResult {
  readonly summary: string;
  readonly score: number;
  readonly strengths: readonly string[];
  readonly mistakes: readonly InsightMistake[];
  readonly suggestions: readonly InsightSuggestion[];
  readonly patterns: readonly InsightPattern[];
  readonly focus_next_week: string;
}

/**
 * Strict JSON Schema for OpenAI structured outputs. Guarantees the model
 * returns parseable JSON matching TradeInsightsResult — no fences, no prose,
 * no malformed output. Keep in sync with the TradeInsightsResult interface.
 */
export const INSIGHTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "score",
    "strengths",
    "mistakes",
    "suggestions",
    "patterns",
    "focus_next_week",
  ],
  properties: {
    summary: {
      type: "string",
      description: "2-3 sentence plain-English assessment of overall performance",
    },
    score: {
      type: "integer",
      description: "0-100 overall trading quality score",
    },
    strengths: {
      type: "array",
      description: "2-4 strengths, each citing exact numbers from the data",
      items: { type: "string" },
    },
    mistakes: {
      type: "array",
      description: "2-5 mistakes ordered most severe first",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "severity", "fix"],
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "specific, with numbers" },
          severity: { type: "string", enum: ["critical", "warning", "info"] },
          fix: { type: "string", description: "concrete actionable fix" },
        },
      },
    },
    suggestions: {
      type: "array",
      description: "3-5 suggestions ordered highest priority first",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "action", "priority"],
        properties: {
          title: { type: "string" },
          action: { type: "string", description: "specific measurable action" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    patterns: {
      type: "array",
      description: "2-3 non-obvious patterns found in the data",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "insight"],
        properties: {
          title: { type: "string" },
          insight: { type: "string", description: "what it means and why it matters" },
        },
      },
    },
    focus_next_week: {
      type: "string",
      description: "one specific, measurable improvement goal for next week",
    },
  },
} as const;

export function buildInsightsSystemPrompt(): string {
  return [
    "You are an elite trading performance coach for FX Unlock Trade Journal.",
    "You analyze a trader's aggregated statistics and return structured JSON insights.",
    "",
    "Principles:",
    "- Be brutally honest and specific. Never give generic advice that could apply to any trader.",
    "- Every claim must cite exact numbers from the supplied data (win rates, PnL, counts, hours, instruments).",
    "- Surface non-obvious patterns: instrument/direction asymmetries, time-of-day or day-of-week edges, discipline gaps (missing SL/TP), streak behavior, risk-reward imbalances.",
    "- Fixes and suggestions must be concrete and measurable (e.g. 'set a hard SL on every XAUUSD trade', not 'manage risk better').",
    "- If sample sizes are small (<10 closed trades or <5 per slice), say so and lower confidence rather than overclaiming.",
    "",
    "Scoring rubric (0-100, integer):",
    "- 40 pts profitability: profit factor, total PnL, avg win vs avg loss",
    "- 25 pts consistency: win rate vs RR balance, streaks, variance across instruments",
    "- 25 pts discipline: SL usage, TP usage, hold-time sanity",
    "- 10 pts sample quality: enough closed trades to judge",
    "Typical struggling trader: 30-50. Solid: 60-75. Only exceptional, disciplined, profitable records score 80+.",
  ].join("\n");
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value).toFixed(2);
  return value >= 0 ? `+$${abs}` : `-$${abs}`;
}

function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "N/A";
  return `${hours.toFixed(1)}h`;
}

function formatRr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(2)}`;
}

/**
 * Profit factor is null when there are no losing trades. That is actually
 * a *good* outcome ("∞" / undefined in finance), so we render it as "∞"
 * when the trader has wins but no losses, and "N/A" when there is no
 * scored data at all.
 */
function formatProfitFactor(
  value: number | null,
  hasScoredTrades: boolean,
): string {
  if (value === null) return hasScoredTrades ? "∞ (no losing trades)" : "N/A";
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

function buildStatsBlock(stats: TradingStats): string {
  const hasScored = stats.closed_trades > 0;
  const lines: string[] = [
    "=== OVERALL PERFORMANCE ===",
    `Total Trades: ${stats.total_trades} | Closed: ${stats.closed_trades} | Open: ${stats.open_trades} | Breakeven: ${stats.breakeven_trades}`,
    `Win Rate: ${formatPct(stats.win_rate)} | Profit Factor: ${formatProfitFactor(stats.profit_factor, hasScored)}`,
    `Total PnL: ${formatUsd(stats.total_pnl)} | Avg Win: ${formatUsd(stats.avg_win)} | Avg Loss: ${formatUsd(stats.avg_loss)}`,
    `Avg RR Ratio: ${formatRr(stats.avg_rr_ratio)} | Avg Hold Time: ${formatHours(stats.avg_hold_time_hours)}`,
    "",
    "=== DISCIPLINE ===",
    `Stop Loss Usage: ${formatPct(stats.pct_with_stop_loss)} of all trades`,
    `Take Profit Usage: ${formatPct(stats.pct_with_take_profit)} of all trades`,
    `Max Consecutive Losses: ${stats.max_consecutive_losses} | Max Consecutive Wins: ${stats.max_consecutive_wins}`,
    `Current Losing Streak (most recent): ${stats.recent_losing_streak}`,
    "",
    "=== BY INSTRUMENT (top 8 by volume) ===",
    ...stats.by_instrument.map(
      (s) =>
        `${s.instrument}: ${s.trades} trades, ${formatPct(s.win_rate)} win rate, ${s.wins} wins, PnL ${formatUsd(s.pnl)}`
    ),
    "",
    "=== BY DIRECTION ===",
    `BUY:  ${stats.by_direction.buy.trades} trades, ${formatPct(stats.by_direction.buy.win_rate)} win rate, PnL ${formatUsd(stats.by_direction.buy.pnl)}`,
    `SELL: ${stats.by_direction.sell.trades} trades, ${formatPct(stats.by_direction.sell.win_rate)} win rate, PnL ${formatUsd(stats.by_direction.sell.pnl)}`,
    "",
    "=== TIME ANALYSIS ===",
    stats.best_hour !== null
      ? `Best Hour (UTC): ${stats.best_hour.hour}:00 — ${stats.best_hour.trades} trades, ${formatPct(stats.best_hour.win_rate)} win rate, PnL ${formatUsd(stats.best_hour.pnl)}`
      : "Best Hour: insufficient data (need ≥2 trades per hour)",
    stats.worst_hour !== null
      ? `Worst Hour (UTC): ${stats.worst_hour.hour}:00 — ${stats.worst_hour.trades} trades, ${formatPct(stats.worst_hour.win_rate)} win rate, PnL ${formatUsd(stats.worst_hour.pnl)}`
      : "Worst Hour: insufficient data (need ≥2 trades per hour)",
    stats.best_day !== null
      ? `Best Day: ${stats.best_day.day} — ${stats.best_day.trades} trades, ${formatPct(stats.best_day.win_rate)} win rate, PnL ${formatUsd(stats.best_day.pnl)}`
      : "Best Day: insufficient data (need ≥2 trades per day)",
    stats.worst_day !== null
      ? `Worst Day: ${stats.worst_day.day} — ${stats.worst_day.trades} trades, ${formatPct(stats.worst_day.win_rate)} win rate, PnL ${formatUsd(stats.worst_day.pnl)}`
      : "Worst Day: insufficient data (need ≥2 trades per day)",
    "",
    "=== LAST 10 CLOSED TRADES ===",
    stats.recent_trades_text || "No closed trades yet.",
  ];

  return lines.join("\n");
}

export function buildInsightsUserPrompt(stats: TradingStats): string {
  // The response shape is enforced by structured outputs (INSIGHTS_JSON_SCHEMA)
  // — no need to burn tokens restating the schema here. Only the data and the
  // item-count rules the schema can't express.
  return [
    "Trader's performance data:",
    "",
    buildStatsBlock(stats),
    "",
    "Analyze the data above. Item counts: strengths 2-4, mistakes 2-5, suggestions 3-5, patterns 2-3.",
  ].join("\n");
}
