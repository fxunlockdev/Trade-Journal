import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { JournalRole } from "@/types/database";

/**
 * List members of a journal (with display info from auth.users + public.users).
 *
 * Uses the SECURITY DEFINER RPC `get_journal_members_with_info` so we can
 * join auth.users.email without needing direct SELECT grants. The RPC gates
 * access to members of the journal.
 */

type RouteContext = { params: Promise<{ id: string }> };

interface MemberRow {
  readonly user_id: string;
  readonly email: string;
  readonly full_name: string;
  readonly avatar_url: string;
  readonly role: JournalRole;
  readonly joined_at: string;
  readonly invited_by_user_id: string | null;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc(
      "get_journal_members_with_info",
      { p_journal_id: id },
    );

    if (error) {
      console.error("[journals/members GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as MemberRow[];
    if (rows.length === 0) {
      // RPC returns empty if caller isn't a member — distinguish from
      // "journal has no members" (impossible — owner always exists).
      return NextResponse.json(
        { error: "You are not a member of this journal." },
        { status: 403 },
      );
    }

    return NextResponse.json({ data: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
