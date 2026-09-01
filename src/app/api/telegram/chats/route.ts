import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { generateClaimCode, CLAIM_BODY_LENGTH } from "@/lib/telegram/claim";

/**
 * Groups this user has PROVEN they are in, plus a code to prove another.
 *
 * This used to list every chat the bot had ever seen, to every signed-in user.
 * That leaked the existence and title of other customers' groups, and paired
 * with a connect handler that never checked the caller's relationship to a
 * chat, it let one customer attach another's group to their own account and
 * publish into it.
 *
 * A Trade Journal account and a Telegram account are unrelated identities, and
 * Telegram cannot be asked to bridge them. So the proof is a code posted IN the
 * group, where only a member could put it.
 */
export const runtime = "nodejs";

/** Long enough to walk to Telegram and paste, short enough that an abandoned
 *  code is not a standing invitation. Mirrors the column default. */
const CODE_TTL_MINUTES = 15;

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!telegramBotToken()) {
      return NextResponse.json(
        {
          error:
            "Telegram isn't configured. Add TELEGRAM_REPORTS_BOT_TOKEN and redeploy.",
        },
        { status: 503 },
      );
    }

    // RLS scopes this to the caller, so another user's claims are absent.
    const { data: claims } = await supabase
      .from("telegram_chat_claims")
      .select("chat_id, chat_title, claimed_at")
      .not("chat_id", "is", null)
      .order("claimed_at", { ascending: false });

    // Deduped: a group claimed twice is still one group.
    const seen = new Set<string>();
    const chats = (claims ?? [])
      .filter((c) => {
        const id = c.chat_id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((c) => ({
        id: c.chat_id as string,
        title: (c.chat_title as string | null) ?? "Untitled chat",
        type: "group" as const,
      }));

    // A fresh code every time this is opened. Reusing an outstanding one would
    // mean a code shown, abandoned, and still live when someone else is looking
    // at the screen. Old unclaimed codes simply expire.
    const admin = createAdminClient();
    const code = generateClaimCode(randomBytes(CLAIM_BODY_LENGTH));
    const expiresAt = new Date(
      Date.now() + CODE_TTL_MINUTES * 60_000,
    ).toISOString();

    const { error: codeError } = await admin
      .from("telegram_chat_claims")
      .insert({ code, user_id: user.id, expires_at: expiresAt });

    if (codeError) {
      return NextResponse.json(
        { error: "Couldn't start the connection. Try again." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      data: chats,
      meta: {
        code,
        expiresAt,
        hint:
          chats.length === 0
            ? `Post ${code} in the group you want to publish to, then check again. That is how the bot knows you are in it.`
            : null,
      },
    });
  } catch (err: unknown) {
    console.error("[telegram/chats] unexpected:", err);
    return NextResponse.json(
      { error: "Couldn't reach Telegram." },
      { status: 502 },
    );
  }
}
