import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setActiveJournalCookie } from "@/lib/journals/active-journal";

/**
 * POST /api/invites/[token]/accept — accept an invite.
 *
 * Requires an authenticated session. Delegates to the SQL RPC
 * `accept_journal_invite` which atomically validates the token (not expired,
 * not revoked, not already accepted), inserts the journal_members row with
 * the role pre-set on the invite, and marks the invite accepted.
 *
 * On success we set the active-journal cookie to the newly-joined journal
 * so the user lands directly inside it after redirect.
 */

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    if (!token || token.length < 10) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in to accept an invite." },
        { status: 401 },
      );
    }

    const { data, error } = await supabase.rpc("accept_journal_invite", {
      p_token: token,
    });

    if (error) {
      // RPC raises clean text messages: "Invite has expired", "Invalid
      // invite token", "Invite has already been accepted", etc. Surface
      // them directly as 400 so the UI can display them.
      console.error("[invites/accept]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const journalId = data as string;
    if (typeof journalId === "string" && journalId.length > 0) {
      await setActiveJournalCookie(journalId);
    }

    return NextResponse.json({
      success: true,
      journal_id: journalId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
