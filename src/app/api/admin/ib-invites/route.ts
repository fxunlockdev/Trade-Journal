import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";
import { generateInviteToken } from "@/lib/crm/invite-token";

/** IB invite links live for 14 days — long enough to email and chase. */
const IB_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * POST /api/admin/ib-invites  { label?, email? }
 *
 * Mints a single-use IB invite link. Admin-only: checked here against the
 * database (not the JWT claim), and again by RLS on insert. The raw token is
 * returned exactly once — only its SHA-256 hash is stored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireProduct("admin");

    const body = (await request.json().catch(() => ({}))) as {
      label?: unknown;
      email?: unknown;
    };
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : null;
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : null;

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + IB_INVITE_TTL_MS).toISOString();

    const { error } = await supabase.from("platform_invites").insert({
      created_by: user.id,
      role: "ib",
      label: label || null,
      email: email || null,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    return NextResponse.json({
      url: `${origin}/ib-invite/${token}`,
      expiresAt,
    });
  } catch (err) {
    const forbidden = err instanceof Error && err.message.includes("forbidden");
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : "Could not create invite." },
      { status: forbidden ? 403 : 500 },
    );
  }
}
