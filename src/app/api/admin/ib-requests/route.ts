import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";

/**
 * POST /api/admin/ib-requests  { targetUserId, approve }
 *
 * Approve or decline a self-declared IB. Admin is checked here against the
 * database and again inside admin_decide_ib_request(), which also refuses
 * anything that isn't actually pending and routes approval through the one
 * sanctioned promotion path (so users.role stays in sync and it's audited).
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
      targetUserId?: unknown;
      approve?: unknown;
    };
    if (typeof body.targetUserId !== "string" || typeof body.approve !== "boolean") {
      return NextResponse.json({ error: "targetUserId and approve are required" }, { status: 400 });
    }

    const { error } = await supabase.rpc("admin_decide_ib_request", {
      p_target: body.targetUserId,
      p_approve: body.approve,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const forbidden = err instanceof Error && err.message.includes("forbidden");
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : "Could not update the request." },
      { status: forbidden ? 403 : 500 },
    );
  }
}
