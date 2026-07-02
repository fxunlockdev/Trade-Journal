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

export function buildInsightsSystemPrompt(): string {
  return (
    "You are an expert trading coach and performance analyst for FX Unlock Trade Journal. " +
    "Analyze trading data and provide brutally honest, specific, actionable feedback. " +
    "You identify patterns humans miss. Be direct and specific — no generic advice. " +
    "Always reference specific numbers from the data. " +
    "Respond with a single JSON object matching the exact schema provided in the user message. " +
    "Output raw JSON only — no markdown, no code fences, no extra commentary."
  );
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
    "=== EMOTIONAL STATE (tagged trades only) ===",
    ...(stats.by_emotion.length > 0
      ? stats.by_emotion.map(
          (s) =>
            `When trading — ${s.emotion}: ${s.trades} trades, ${formatPct(s.win_rate)} win rate, PnL ${formatUsd(s.pnl)}`
        )
      : ["When trading: no emotions tagged yet."]),
    ...(stats.by_emotion_post.length > 0
      ? stats.by_emotion_post.map(
          (s) =>
            `After trade — ${s.emotion}: ${s.trades} trades, ${formatPct(s.win_rate)} win rate, PnL ${formatUsd(s.pnl)}`
        )
      : ["After trade: no emotions tagged yet."]),
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

function buildResponseSchema(): string {
  return JSON.stringify(
    {
      summary: "2-3 sentence plain-English assessment of overall performance",
      score:
        "0-100 integer: overall trading quality based on win rate, profit factor, RR ratio, and discipline (SL/TP usage)",
      strengths: [
        "specific strength with exact numbers, e.g. 'Win rate on BTCUSDT is 71% across 14 trades'",
        "... (2-4 items)",
      ],
      mistakes: [
        {
          title: "short title",
          description: "specific description with numbers",
          severity: "critical | warning | info",
          fix: "concrete actionable fix",
        },
      ],
      suggestions: [
        {
          title: "short title",
          action: "specific measurable action",
          priority: "high | medium | low",
        },
      ],
      patterns: [
        {
          title: "short pattern title",
          insight: "what the pattern means and why it matters",
        },
      ],
      focus_next_week:
        "one specific, measurable improvement goal for next week",
    },
    null,
    2
  );
}

export function buildInsightsUserPrompt(stats: TradingStats): string {
  const statsBlock = buildStatsBlock(stats);
  const schema = buildResponseSchema();

  return [
    "Here is the trader's performance data:",
    "",
    statsBlock,
    "",
    "---",
    "",
    "Analyze this data and respond with a JSON object that matches EXACTLY this schema:",
    "",
    schema,
    "",
    "Rules:",
    "- strengths: 2-4 items, each must cite specific numbers from the data above",
    "- mistakes: 2-5 items; severity must be one of: critical, warning, info",
    "- suggestions: 3-5 items; priority must be one of: high, medium, low",
    "- patterns: 2-3 items",
    "- If emotional-state data is present, surface at least one pattern or mistake correlating an emotion (e.g. FOMO, Revenge, Greedy) with win rate or PnL, citing the exact numbers.",
    "- score: integer 0-100",
    "- Output raw JSON only. No markdown, no fences, no extra text.",
  ].join("\n");
}
