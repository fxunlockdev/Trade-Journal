import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side rate limiting, backed by Postgres (see migration 20260817170000).
 *
 * Shared across serverless instances — an in-memory limiter would reset on every
 * cold start and count separately per instance, which is barely a limit at all.
 *
 * Bucket keys are always built here from the request, never accepted from the
 * client.
 */

/** Best-effort client IP. Vercel sets x-forwarded-for; take the first hop. */
export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitRule {
  /** Namespace, e.g. "assistant". Combined with the identity to form the bucket. */
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
}

/**
 * Returns true when the caller is within their allowance.
 *
 * Fails OPEN on an unexpected database error: a limiter outage should not take
 * the product down. It fails CLOSED on an explicit denial, which is the case
 * that matters.
 */
export async function allowRequest(
  supabase: SupabaseClient,
  rule: RateLimitRule,
  identity: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: `${rule.name}:${identity}`,
    p_max: rule.max,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) return true;
  return data !== false;
}

/** Occasionally sweep expired counters so the table stays small. */
export async function maybePrune(supabase: SupabaseClient): Promise<void> {
  if (Math.random() > 0.01) return; // ~1% of requests
  await supabase.rpc("prune_rate_limits");
}

export const LIMITS = {
  /** The model path is the expensive one — keep it tight per user. */
  assistant: { name: "assistant", max: 20, windowSeconds: 60 },
  /** Lead capture is anonymous, so it's the obvious spam target. */
  rebateLead: { name: "rebate_lead", max: 5, windowSeconds: 3600 },
  // A button that makes Telegram notify a room full of partners, so a stuck
  // finger must not become twenty notifications for everyone in it.
  telegramTest: { name: "telegram_test", max: 5, windowSeconds: 300 },
  /** Minting a link code creates a credential; a page reload must not mint
   *  another, and a script must not mint hundreds. */
  telegramLink: { name: "telegram_link", max: 10, windowSeconds: 3600 },
  /** Every DM and every button tap that makes the bot do work. A guided trade
   *  is six messages, and an evening's backfill is twenty trades, so the
   *  allowance is sized for that rather than for one message per trade.
   *  Keyed on the Telegram user, so a flood from one account is contained. */
  telegramDm: { name: "telegram_dm", max: 200, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;
