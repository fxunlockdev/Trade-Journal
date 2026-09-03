import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken } from "@/lib/telegram/config";
import { generateLinkCode, CLAIM_BODY_LENGTH } from "@/lib/telegram/claim";
import { allowRequest, LIMITS } from "@/lib/rate-limit";

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
 *  is not a standing invitation to link a stranger's Telegram account. The
 *  card renders this value, so the number the user reads is this one. */
export const CODE_TTL_MINUTES = 15;

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // RLS-scoped AND filtered: the policy is the gate, the filter is the
    // statement of intent, and a read error is an error, not "not linked".
    const { data: linked, error } = await supabase
      .from("telegram_accounts")
      .select("telegram_user_id, linked_at, last_seen_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: "Couldn't read the link status." }, { status: 503 });
    }

    return NextResponse.json({
      data: {
        linked: linked !== null,
        linkedAt: linked?.linked_at ?? null,
        lastSeenAt: linked?.last_seen_at ?? null,
      },
    });
  } catch (err: unknown) {
    console.error("[telegram/link] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Mint a fresh code, or return the one still outstanding.
 *
 * A POST rather than a GET because it creates a credential. Rate-limited per
 * user for the same reason. "One live code per user" is enforced by a unique
 * partial index, so two simultaneous requests get the same code rather than
 * two.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!telegramBotToken()) {
      return NextResponse.json({ error: "The Telegram bot is not configured." }, { status: 503 });
    }

    if (!(await allowRequest(supabase, LIMITS.telegramLink, user.id))) {
      return NextResponse.json(
        { error: "Too many codes requested. Try again in an hour." },
        { status: 429 },
      );
    }

    const admin = createAdminClient();
    const openCode = async () => {
      const { data } = await admin
        .from("telegram_account_links")
        .select("code, expires_at")
        .eq("user_id", user.id)
        .is("claimed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    };

    const open = await openCode();
    if (open) {
      return NextResponse.json({
        data: { code: open.code, expiresAt: open.expires_at, reused: true, ttlMinutes: CODE_TTL_MINUTES },
      });
    }

    // An expired-but-unclaimed code would collide with the one-open-per-user
    // index, so it is retired first.
    await admin
      .from("telegram_account_links")
      .update({ claimed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("claimed_at", null);

    const code = generateLinkCode(randomBytes(CLAIM_BODY_LENGTH));
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

    const { error } = await admin
      .from("telegram_account_links")
      .insert({ code, user_id: user.id, expires_at: expiresAt });

    if (error?.code === "23505") {
      // Another request minted between the read and the insert. Its code is
      // as good as ours would have been.
      const raced = await openCode();
      if (raced) {
        return NextResponse.json({
          data: { code: raced.code, expiresAt: raced.expires_at, reused: true, ttlMinutes: CODE_TTL_MINUTES },
        });
      }
    }
    if (error) {
      return NextResponse.json({ error: "Couldn't start linking. Try again." }, { status: 503 });
    }

    return NextResponse.json({
      data: { code, expiresAt, reused: false, ttlMinutes: CODE_TTL_MINUTES },
    });
  } catch (err: unknown) {
    console.error("[telegram/link] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Unlink, and revoke everything that could re-establish the link.
 *
 * RLS-scoped, so this can only ever remove the caller's own link. Someone who
 * loses a phone or leaves needs to be able to sever this without asking
 * anybody, and a link that cannot be revoked is a standing grant to write
 * trades into their journals. A code minted minutes earlier would re-create
 * that grant, and an unconfirmed draft would still be tappable if the same
 * Telegram account linked again, so both are retired here too.
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: removed, error } = await supabase
      .from("telegram_accounts")
      .delete()
      .eq("user_id", user.id)
      .select("telegram_user_id");

    if (error) {
      return NextResponse.json({ error: "Couldn't unlink. Try again." }, { status: 503 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin
      .from("telegram_account_links")
      .update({ expires_at: now })
      .eq("user_id", user.id)
      .is("claimed_at", null);
    await admin
      .from("telegram_pending_trades")
      .update({ consumed_at: now })
      .eq("user_id", user.id)
      .is("consumed_at", null);

    return NextResponse.json({ data: { linked: false, removed: removed?.length ?? 0 } });
  } catch (err: unknown) {
    console.error("[telegram/link] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
