import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/lib/crm/invite-token";

/**
 * POST /api/crm/join  { token }
 *
 * Accepts a CRM join link for the *currently signed-in* user. The raw token is
 * hashed server-side and passed to accept_crm_invite() (SECURITY DEFINER),
 * which enforces single-use, TTL, revocation, self-accept rejection and the
 * one-active-IB-per-member rule. The accepting account is whoever is signed in
 * — deliberately, so a forwarded link binds the person who actually accepts.
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

    const { data, error } = await supabase.rpc("accept_crm_invite", {
      p_token_hash: hashInviteToken(body.token),
    });

    if (error) {
      // The definer function raises friendly messages (expired, revoked, already
      // used, own invite, already linked). Surface them without leaking internals.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ error: "Could not accept invite." }, { status: 500 });
  }
}
