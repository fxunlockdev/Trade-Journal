import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * One-time admin bootstrap.
 *
 * Promotes the *calling* user to admin when they present the deployment's
 * BOOTSTRAP_SECRET. Used once, to create the first admin on a fresh
 * deployment; the secret is unset afterwards, which disables this endpoint
 * (503).
 *
 * Security notes:
 *  - The privilege write goes through the service-role client. It must never
 *    go through the caller's own session: users have no UPDATE grant on
 *    `role`/`platform_role` (that was the P0 escalation hole), and a route
 *    that depended on such a grant would be re-opening it.
 *  - Both role columns are set together so the journal capability flag and the
 *    platform entitlement can't drift apart.
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

    // Require explicit BOOTSTRAP_SECRET env var — no fallback.
    // Without this guard, anyone who knows the hardcoded default could
    // promote themselves to admin on a misconfigured deployment.
    const expectedSecret = process.env.BOOTSTRAP_SECRET;
    if (!expectedSecret || expectedSecret.length < 16) {
      console.error(
        "[TRDR] BOOTSTRAP_SECRET is not set or too short (<16 chars). Bootstrap endpoint disabled.",
      );
      return NextResponse.json(
        { error: "Bootstrap endpoint is not configured" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { secret?: string };
    if (body.secret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
    }

    // Privilege escalation is a service-role operation, never a user-session one.
    const admin = createAdminClient();
    const { error } = await admin
      .from("users")
      .update({ role: "admin", platform_role: "admin" })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${user.email} is now admin`,
    });
  } catch (_err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
