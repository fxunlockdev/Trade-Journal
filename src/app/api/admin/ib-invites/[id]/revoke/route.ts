import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/ib-invites/[id]/revoke — kill an unused invite link.
 * Admin-only (DB re-check + RLS). Already-accepted invites are left alone;
 * revoking one wouldn't undo the access it granted, and the audit trail should
 * keep showing it was used. Demote the user in the tier list instead.
 */
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

    await requireProduct("admin");

    const { error } = await supabase
      .from("platform_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("accepted_at", null)
      .is("revoked_at", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const forbidden = err instanceof Error && err.message.includes("forbidden");
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : "Could not revoke invite." },
      { status: forbidden ? 403 : 500 },
    );
  }
}
