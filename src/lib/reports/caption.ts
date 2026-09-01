import type { ReportMetrics } from "@/lib/reports/metrics";
import { CAPTION_MAX } from "@/lib/telegram/media";

/**
 * The words under an album.
 *
 * Pure, so the wording is unit-testable without a Telegram account. Every
 * figure comes from the frozen snapshot, never recomputed here: the caption and
 * the images it sits under must agree, and the only way to guarantee that is
 * for both to read the same stored numbers.
 */

export type Cadence = "daily" | "weekly" | "monthly";

const CADENCE_WORD: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/**
 * Escape text destined for a `parse_mode: HTML` caption.
 *
 * Desk names are typed by users. Without this, a desk called `Gold <b>` either
 * breaks the whole send (Telegram rejects malformed entities, taking the images
 * down with it) or smuggles formatting into a published post. Telegram's HTML
 * mode needs exactly these three escaped.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A signed number, so a positive result never reads as ambiguous. */
function signed(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  // `-0` formats as "-0", which reads as a small loss rather than flat.
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return `${safe > 0 ? "+" : ""}${safe.toFixed(digits)}`;
}

export interface CaptionInput {
  readonly deskName: string;
  readonly cadence: Cadence;
  /** Already formatted for humans, e.g. "1 Sep 2026" or "25 to 29 Aug 2026". */
  readonly periodLabel: string;
  readonly metrics: ReportMetrics;
}

/**
 * Three lines: who, when, and how it went.
 *
 * Deliberately short. The posters carry the detail; a caption that repeats them
 * gives a reader two places to check and a chance to disagree with itself.
 */
export function buildCaption(input: CaptionInput): string {
  const { stats } = input.metrics;

  const lines: string[] = [
    `<b>${escapeHtml(input.deskName)}</b>`,
    `${CADENCE_WORD[input.cadence]} · ${escapeHtml(input.periodLabel)}`,
    "",
    `${stats.tradeCount} ${stats.tradeCount === 1 ? "trade" : "trades"} · ${Math.round(stats.winRate)}% win rate · ${signed(stats.pips)} pips`,
  ];

  // R is only meaningful when trades carried a stop. Printing "0R" for a set
  // that never had one states a result that was never measured.
  if (input.metrics.netR !== null && stats.rCovered > 0) {
    const partial =
      stats.rCovered < stats.tradeCount
        ? ` (${stats.rCovered} of ${stats.tradeCount} with a stop)`
        : "";
    lines.push(`Net ${signed(input.metrics.netR, 1)}R${partial}`);
  }

  // Money is omitted entirely rather than shown mixed. `metrics` already nulls
  // it for a multi-currency period; this just declines to invent a total.
  if (input.metrics.netPnl !== null && input.metrics.currency) {
    lines.push(
      `Net ${signed(input.metrics.netPnl, 2)} ${escapeHtml(input.metrics.currency)}`,
    );
  }

  const caption = lines.join("\n");
  // Truncating mid-tag would produce a malformed entity and a rejected send.
  // The content above cannot realistically reach 1024 characters, so this is a
  // backstop: drop whole lines rather than cut one.
  if (caption.length <= CAPTION_MAX) return caption;
  let trimmed = "";
  for (const line of lines) {
    if ((trimmed + line).length + 1 > CAPTION_MAX) break;
    trimmed += (trimmed ? "\n" : "") + line;
  }
  return trimmed;
}
