import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/lib/crm/invite-token";

/**
 * POST /api/ib-invite/accept  { token }
 *
 * Upgrades the signed-in user to IB. All validation (single-use, TTL, revoked,
 * never-downgrade, never-grants-admin) lives in accept_platform_invite(), a
 * SECURITY DEFINER function — the invitee has no rights over the invite row or
 * their own platform_role, which is the point.
 *
 * Deliberately separate from /api/crm/join: platform invites and CRM roster
 * invites are different token spaces and must never cross-accept.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== "string" || body.token.length < 20) {
      return NextResponse.json({ error: "Invalid invite." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("accept_platform_invite", {
      p_token_hash: hashInviteToken(body.token),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ error: "Could not accept invite." }, { status: 500 });
  }
}
