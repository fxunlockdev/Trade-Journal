import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/crm/affiliates/[id]/unlink
 *
 * Revokes the access an IB granted: clears the member link, marks the affiliate
 * INACTIVE, revokes any pending invites, and writes an audit row. This controls
 * the LINK only — it never touches the member's own account or data (that's
 * theirs; account suspension is admin-only, per the golden rule).
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id: affiliateId } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireProduct("crm");

    const { data: affiliate, error: afError } = await supabase
      .from("affiliates")
      .select("id, member_user_id")
      .eq("id", affiliateId)
      .single<{ id: string; member_user_id: string | null }>();
    if (afError || !affiliate) {
      return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
    }

    const previousMember = affiliate.member_user_id;

    // Clear the link (RLS scopes this to the owner's own row).
    const { error: updateError } = await supabase
      .from("affiliates")
      .update({ member_user_id: null, status: "INACTIVE" })
      .eq("id", affiliateId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Revoke any still-pending invites so the old link can't be re-accepted.
    await supabase
      .from("crm_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("affiliate_id", affiliateId)
      .is("accepted_at", null)
      .is("revoked_at", null);

    await supabase.from("crm_audit").insert({
      owner_id: user.id,
      actor_user_id: user.id,
      action: "unlink",
      affiliate_id: affiliateId,
      target_user_id: previousMember,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const forbidden = err instanceof Error && err.message.includes("forbidden");
    return NextResponse.json(
      { error: forbidden ? "You don't have access to the CRM." : "Could not unlink." },
      { status: forbidden ? 403 : 500 },
    );
  }
}
