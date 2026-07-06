import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Revoke an MT5 connection. Soft delete (revoked_at) so the row keeps its
 * account/broker/last-sync history; the ingest route filters revoked tokens
 * and returns a distinct 401 body the EA can log meaningfully.
 */
export async function DELETE(
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

    const admin = createAdminClient();

    // Ownership gate — only the creator can revoke their connection.
    const { data: existing } = await admin
      .from("mt5_connections")
      .select("id, user_id, revoked_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.user_id !== user.id) {
      // 404 not 403 — don't reveal other users' connection ids.
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (existing.revoked_at) {
      return NextResponse.json({ error: "Already revoked" }, { status: 409 });
    }

    const { error } = await admin
      .from("mt5_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[mt5/connections DELETE] revoke failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
