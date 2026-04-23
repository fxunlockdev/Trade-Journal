import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setActiveJournalCookie } from "@/lib/journals/active-journal";

/**
 * Switch the caller's active journal. Verifies membership before writing the
 * `trdr_active_journal` cookie — never trust a client-supplied id without a
 * membership check, otherwise a user could set their cookie to any journal
 * uuid and get a 500 on every page render.
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
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

    const { data: membership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this journal." },
        { status: 403 },
      );
    }

    await setActiveJournalCookie(id);

    return NextResponse.json({
      success: true,
      active_journal_id: id,
      role: membership.role,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
