import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { generateClaimCode, CLAIM_BODY_LENGTH } from "@/lib/telegram/claim";
import { allowRequest, LIMITS } from "@/lib/rate-limit";

/**
 * A code to prove this person is in a room the bot should listen to.
 *
 * Same mechanism as connecting a group for posters, one difference: when
 * this code is posted the bot says NOTHING. A signals room must never hear
 * from it. The Posters page shows the room once the code has been seen.
 */
export const runtime = "nodejs";

const CODE_TTL_MINUTES = 15;

export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!telegramBotToken()) return NextResponse.json({ error: "The Telegram bot is not configured." }, { status: 503 });
    if (!(await allowRequest(supabase, LIMITS.telegramFeedCode, user.id))) {
      return NextResponse.json({ error: "Too many codes requested. Try again in an hour." }, { status: 429 });
    }
    const admin = createAdminClient();
    const code = generateClaimCode(randomBytes(CLAIM_BODY_LENGTH));
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
    const { error: insertError } = await admin
      .from("telegram_chat_claims")
      .insert({ code, user_id: user.id, expires_at: expiresAt, purpose: "feed" });
    if (insertError) return NextResponse.json({ error: "Couldn't start. Try again." }, { status: 503 });
    return NextResponse.json({ data: { code, expiresAt, ttlMinutes: CODE_TTL_MINUTES } });
  } catch (err: unknown) {
    console.error("[telegram/feeds/code] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
