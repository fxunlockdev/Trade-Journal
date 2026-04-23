import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/invites/[token] — public inspection of an invite.
 *
 * Used by the /invite/[token] landing page BEFORE the visitor is logged in.
 * Returns the journal name, colour, inviter display info, and invite status
 * (expired / revoked / already-accepted / pending). The SQL RPC
 * `get_invite_public_info` is SECURITY DEFINER and grants execute to `anon`
 * so this endpoint doesn't need the caller to be authenticated.
 *
 * We use the admin client here to avoid RLS tripping on journal_invites
 * for anon callers — the token itself is the authorization.
 */

type RouteContext = { params: Promise<{ token: string }> };

interface InvitePublicInfo {
  readonly journal_id: string;
  readonly journal_name: string;
  readonly journal_color: string;
  readonly role: string;
  readonly inviter_email: string;
  readonly inviter_name: string;
  readonly expires_at: string;
  readonly accepted_at: string | null;
  readonly revoked_at: string | null;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    if (!token || token.length < 10) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_invite_public_info", {
      p_token: token,
    });

    if (error) {
      console.error("[invites/[token] GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as InvitePublicInfo[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const invite = rows[0];
    const now = Date.now();
    const status: "pending" | "accepted" | "revoked" | "expired" =
      invite.accepted_at
        ? "accepted"
        : invite.revoked_at
          ? "revoked"
          : new Date(invite.expires_at).getTime() < now
            ? "expired"
            : "pending";

    return NextResponse.json({ data: { ...invite, status } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
