import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { generateLinkCode, CLAIM_BODY_LENGTH } from "@/lib/telegram/claim";

/**
 * Linking a Telegram account to a Trade Journal account.
 *
 * A Trade Journal account and a Telegram account are unrelated identities, and
 * Telegram cannot bridge them. So the user proves the link the only way
 * available: the app mints a one-time code and they send it to the bot from
 * the Telegram account they want linked. Only that account can send from
 * itself, so the message is the proof.
 *
 * This is what makes "which of Pierre's journals?" answerable at all. The
 * existing chat-to-owner mapping is one chat to one owner, so it cannot tell
 * two people apart in the same room.
 *
 * A DM, not a group: their marketing channel has partners in it, and neither a
 * linking code nor a stream of trade messages belongs in front of them.
 */
export const runtime = "nodejs";

/** Long enough to switch apps and paste, short enough that an abandoned code
 *  is not a standing invitation to link a stranger's Telegram account. */
const CODE_TTL_MINUTES = 15;

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: only this user's own link can be seen.
  const { data: linked } = await supabase
    .from("telegram_accounts")
    .select("telegram_user_id, linked_at, last_seen_at")
    .maybeSingle();

  return NextResponse.json({
    data: {
      linked: linked !== null,
      linkedAt: linked?.linked_at ?? null,
      lastSeenAt: linked?.last_seen_at ?? null,
    },
  });
}

/**
 * Mint a fresh code.
 *
 * A POST rather than a GET because it creates a credential. The chat-connect
 * flow mints on GET and that was wrong for the same reason; this one does not
 * copy it.
 */
export async function POST(): Promise<NextResponse> {
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
        { error: "The Telegram bot is not configured." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();

    // Reuse an outstanding, unexpired, unclaimed code rather than minting a new
    // one on every page load. A pile of simultaneously-live codes widens the
    // window in which any of them can link an account.
    const { data: open } = await admin
      .from("telegram_account_links")
      .select("code, expires_at")
      .eq("user_id", user.id)
      .is("claimed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (open) {
      return NextResponse.json({
        data: { code: open.code, expiresAt: open.expires_at, reused: true },
      });
    }

    const code = generateLinkCode(randomBytes(CLAIM_BODY_LENGTH));
    const expiresAt = new Date(
      Date.now() + CODE_TTL_MINUTES * 60_000,
    ).toISOString();

    const { error } = await admin
      .from("telegram_account_links")
      .insert({ code, user_id: user.id, expires_at: expiresAt });

    if (error) {
      return NextResponse.json(
        { error: "Couldn't start linking. Try again." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      data: { code, expiresAt, reused: false },
    });
  } catch (err: unknown) {
    console.error("[telegram/link] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Unlink.
 *
 * RLS-scoped, so this can only ever remove the caller's own link. Someone who
 * loses a phone or leaves needs to be able to sever this without asking
 * anybody, and a link that cannot be revoked is a standing grant to write
 * trades into their journals.
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("telegram_accounts")
      .delete()
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Couldn't unlink. Try again." },
        { status: 503 },
      );
    }

    return NextResponse.json({ data: { linked: false } });
  } catch (err: unknown) {
    console.error("[telegram/link] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
