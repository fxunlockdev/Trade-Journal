import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/journals/[id]/invites/[inviteId] — revoke an invite link.
 *
 * We don't actually delete the row (for audit traceability). We set
 * `revoked_at = now()` so the token is invalid and the link landing page
 * shows "this invite has been revoked".
 */

type RouteContext = {
  params: Promise<{ id: string; inviteId: string }>;
};

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id, inviteId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: myMembership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!myMembership || myMembership.role !== "owner") {
      return NextResponse.json(
        { error: "Only journal owners can revoke invites." },
        { status: 403 },
      );
    }

    const { error } = await supabase
      .from("journal_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .eq("journal_id", id);

    if (error) {
      console.error("[invites DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
