import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";
import { generateInviteToken, INVITE_TTL_MS } from "@/lib/crm/invite-token";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/crm/affiliates/[id]/invite
 *
 * Creates a single-use, 72h join link for a roster row. Server-side so the
 * token is CSPRNG-generated and only its hash is stored. Re-inviting revokes
 * any still-pending invite for the same affiliate first.
 *
 * Authorization: middleware gates /crm, but this re-checks entitlement from the
 * DB (requireProduct) and inserts under RLS scoped to owner_id = auth.uid().
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

    // Confirm the caller owns this roster row (RLS would also block, but fail
    // clearly). Also refuse to invite an already-linked affiliate.
    const { data: affiliate, error: afError } = await supabase
      .from("affiliates")
      .select("id, name, email, member_user_id")
      .eq("id", affiliateId)
      .single<{ id: string; name: string; email: string | null; member_user_id: string | null }>();

    if (afError || !affiliate) {
      return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
    }
    if (affiliate.member_user_id) {
      return NextResponse.json(
        { error: "This affiliate is already linked to an account." },
        { status: 409 },
      );
    }

    // Supersede any pending invite for this affiliate.
    await supabase
      .from("crm_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("affiliate_id", affiliateId)
      .is("accepted_at", null)
      .is("revoked_at", null);

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const { error: insertError } = await supabase.from("crm_invites").insert({
      owner_id: user.id,
      affiliate_id: affiliateId,
      email: affiliate.email,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    await supabase.from("crm_audit").insert({
      owner_id: user.id,
      actor_user_id: user.id,
      action: "invite",
      affiliate_id: affiliateId,
      detail: { email: affiliate.email },
    });

    const origin = new URL(_request.url).origin;
    // Raw token returned exactly once, to be copied/emailed. Never stored.
    return NextResponse.json({
      url: `${origin}/join/${token}`,
      expiresAt,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes("forbidden")
        ? "You don't have access to the CRM."
        : "Could not create invite.";
    const status = message.includes("access") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
