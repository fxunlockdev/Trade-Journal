import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProduct } from "@/lib/auth/entitlements";

const VALID_ROLES = ["affiliate", "ib", "admin"] as const;
type Role = (typeof VALID_ROLES)[number];

/**
 * POST /api/admin/platform-role  { targetUserId, role }
 *
 * Changes a user's tier. Authorization is enforced twice: requireProduct here,
 * and again inside admin_set_platform_role() (SECURITY DEFINER), which also
 * blocks self-changes and last-admin demotion and writes the audit row. No
 * service-role client is involved.
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

    // 404 shape for non-admins would be nicer, but this is a POST endpoint; a
    // plain 403 after the DB re-check is fine and never leaks the surface.
    await requireProduct("admin");

    const body = (await request.json().catch(() => ({}))) as {
      targetUserId?: unknown;
      role?: unknown;
    };
    if (typeof body.targetUserId !== "string") {
      return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
    }
    if (typeof body.role !== "string" || !VALID_ROLES.includes(body.role as Role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { error } = await supabase.rpc("admin_set_platform_role", {
      p_target: body.targetUserId,
      p_role: body.role,
    });
    if (error) {
      // Friendly messages come from the definer function (own role, last admin…).
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const forbidden = err instanceof Error && err.message.includes("forbidden");
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : "Could not change role." },
      { status: forbidden ? 403 : 500 },
    );
  }
}
